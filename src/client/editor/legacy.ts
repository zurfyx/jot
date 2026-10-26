import { Awareness } from '@y/protocols/awareness';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import * as decoding from 'lib0/decoding';

import { isNoteId, NOTE_SOCKET_BASE } from '../../shared/ids';
import {
  MESSAGE_NOTE_STATUS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_2,
  SYNC_UPDATE,
} from '../../shared/protocol';
import { LEGACY_PENDING_PREFIX } from '../notes';

/**
 * The migration from local drafts (D23). An earlier version of jot kept
 * notes in localStorage: an unshared draft under `jot:draft` (notes.ts hands
 * it to the next new note) and, for a note shared moments before its tab
 * closed, a copy under `jot:pending:<id>` until the relay confirmed it. Each
 * copy left is pushed to its note from a headless client, and cleared once
 * the server has all of it, or has refused it.
 */

/** How long a push may take before it gives up, keeping the copy for next time. */
export const LEGACY_PUSH_TIMEOUT_MS = 30_000;

/** The Yjs update a stored copy (`{ id, state }`, state in base64) holds; null if unreadable. */
export function parseLegacyCopy(stored: string | null): Uint8Array | null {
  if (stored === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(stored);
    const state =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>).state
        : undefined;
    if (typeof state !== 'string' || state === '') {
      return null;
    }
    const binary = atob(state);
    const update = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      update[i] = binary.charCodeAt(i);
    }
    // Throws if it isn't a Yjs update.
    Y.applyUpdate(new Y.Doc(), update);
    return update;
  } catch {
    return null;
  }
}

/** The note ids that have a copy waiting, from the storage's keys. */
export function legacyCopyIds(storage: Storage): string[] {
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_PENDING_PREFIX)) {
      ids.push(key.slice(LEGACY_PENDING_PREFIX.length));
    }
  }
  return ids;
}

/**
 * Whether `copy` holds anything the document `state` lacks, inserts and
 * deletes alike: false once the server has all of it. Checked on a scratch
 * document (gc off, so deleted content the server has collected still counts
 * as known).
 */
export function copyAddsTo(state: Uint8Array, copy: Uint8Array): boolean {
  const scratch = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(scratch, state);
    let changed = false;
    scratch.on('update', () => {
      changed = true;
    });
    // A copy is a whole document's state, so nothing in it waits on content
    // it doesn't carry: it integrates fully, and any change shows here.
    Y.applyUpdate(scratch, copy);
    return changed;
  } finally {
    scratch.destroy();
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Removes `key` only while it still holds `expected`. */
function removeStored(key: string, expected: string | null): void {
  try {
    if (localStorage.getItem(key) === expected) {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage went away: nothing to remove.
  }
}

/** Copies being pushed now, so a second note page doesn't push them twice. */
const pushing = new Set<string>();

function socketBase(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

/** Pushes every copy left in this browser to its note. Called when a note page opens. */
export function pushLegacyCopies(): void {
  let ids: string[];
  try {
    ids = legacyCopyIds(localStorage);
  } catch {
    return;
  }
  for (const id of ids) {
    if (!pushing.has(id)) {
      pushCopy(id);
    }
  }
}

/**
 * Pushes one copy from a headless client with no presence. Its document
 * starts empty, so the server's sync step 2 is its whole state; that and
 * every update the server applies after it are mirrored into `server`. Once
 * synced, a copy that adds nothing to the mirror is already there, and is
 * removed; otherwise the copy is written to the document, which the provider
 * sends, and removed once the server's echo shows all of it. If
 * the server refuses it (the note is full), it can never land: it is removed
 * too. If neither happens within LEGACY_PUSH_TIMEOUT_MS, it is kept for the
 * next note page.
 */
function pushCopy(id: string): void {
  const key = `${LEGACY_PENDING_PREFIX}${id}`;
  const stored = readStored(key);
  const update = isNoteId(id) ? parseLegacyCopy(stored) : null;
  if (update === null) {
    // Not a note's copy, or unreadable: nothing to push.
    removeStored(key, stored);
    return;
  }
  pushing.add(id);

  // Empty at first, so the server's sync step 2 is its whole state.
  const doc = new Y.Doc();
  const server = new Y.Doc({ gc: false });
  // No presence: this client only carries the copy.
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  const provider = new WebsocketProvider(`${socketBase()}${NOTE_SOCKET_BASE}`, `${id}/ws`, doc, {
    connect: false,
    awareness,
    disableBc: true,
  });

  let sent = false;
  let done = false;
  const finish = (drop: boolean) => {
    if (done) {
      return;
    }
    done = true;
    clearTimeout(deadline);
    if (drop) {
      removeStored(key, stored);
    }
    // After this message's handlers return.
    setTimeout(() => {
      provider.destroy();
      awareness.destroy();
      doc.destroy();
      server.destroy();
      pushing.delete(id);
    });
  };

  provider.messageHandlers[MESSAGE_NOTE_STATUS] = (_encoder, decoder) => {
    decoding.readVarUint(decoder);
    if ((decoding.readVarUint(decoder) & NOTE_STATUS_REJECTED) !== 0) {
      finish(true);
    }
  };
  const handleSync = provider.messageHandlers[MESSAGE_SYNC]!;
  provider.messageHandlers[MESSAGE_SYNC] = (encoder, decoder, ...rest) => {
    const peek = decoding.createDecoder(decoder.arr);
    peek.pos = decoder.pos;
    const type = decoding.readVarUint(peek);
    if (type === SYNC_STEP_2 || type === SYNC_UPDATE) {
      Y.applyUpdate(server, decoding.readVarUint8Array(peek));
    }
    handleSync(encoder, decoder, ...rest);
    if (!provider.synced) {
      return;
    }
    if (!copyAddsTo(Y.encodeStateAsUpdate(server), update)) {
      finish(true);
    } else if (!sent) {
      // The server lacks some of it: write the copy, which the provider sends.
      sent = true;
      Y.applyUpdate(doc, update);
    }
  };
  const deadline = setTimeout(() => finish(false), LEGACY_PUSH_TIMEOUT_MS);
  provider.connect();
}
