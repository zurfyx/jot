import { Awareness } from '@y/protocols/awareness';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import * as decoding from 'lib0/decoding';

import { isNoteId, NOTE_SOCKET_BASE } from '../../shared/ids';
import { MESSAGE_NOTE_STATUS, MESSAGE_SYNC, SYNC_STEP_1 } from '../../shared/protocol';
import { LEGACY_PENDING_PREFIX } from '../notes';
import { excludeServerState, unconfirmedDocument } from './confirm';

/**
 * The migration from local drafts (D23). An earlier version of jot kept
 * notes in localStorage: an unshared draft under `jot:draft` (notes.ts hands
 * it to the next new note) and, for a note shared moments before its tab
 * closed, a copy under `jot:pending:<id>` until the relay confirmed it. Each
 * copy left is pushed to its note once, from a headless client, and cleared
 * when the relay has confirmed all of it.
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

function pushCopy(id: string): void {
  const key = `${LEGACY_PENDING_PREFIX}${id}`;
  const stored = localStorage.getItem(key);
  const update = isNoteId(id) ? parseLegacyCopy(stored) : null;
  if (update === null) {
    // Not a note's copy, or unreadable: nothing to push.
    localStorage.removeItem(key);
    return;
  }
  pushing.add(id);

  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  // No presence: this client only carries the copy.
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  const provider = new WebsocketProvider(`${socketBase()}${NOTE_SOCKET_BASE}`, `${id}/ws`, doc, {
    connect: false,
    awareness,
    disableBc: true,
  });
  provider.messageHandlers[MESSAGE_NOTE_STATUS] = (_encoder, decoder) => {
    decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
  };
  provider.unconfirmedUpdates.push(unconfirmedDocument(doc));
  // As on a note page (session.ts): content the server already has is
  // confirmed by its sync step 1; the rest by the relay's echo.
  const handleSync = provider.messageHandlers[MESSAGE_SYNC]!;
  provider.messageHandlers[MESSAGE_SYNC] = (encoder, decoder, ...rest) => {
    const peek = decoding.createDecoder(decoder.arr);
    peek.pos = decoder.pos;
    const stateVector =
      decoding.readVarUint(peek) === SYNC_STEP_1
        ? Y.decodeStateVector(decoding.readVarUint8Array(peek))
        : null;
    handleSync(encoder, decoder, ...rest);
    if (stateVector !== null) {
      provider.unconfirmedUpdates = excludeServerState(provider.unconfirmedUpdates, stateVector);
    }
  };

  const finish = (confirmed: boolean) => {
    clearInterval(poll);
    clearTimeout(deadline);
    if (confirmed && localStorage.getItem(key) === stored) {
      localStorage.removeItem(key);
    }
    provider.destroy();
    awareness.destroy();
    doc.destroy();
    pushing.delete(id);
  };
  const poll = setInterval(() => {
    if (provider.synced && provider.unconfirmedUpdates.length === 0) {
      finish(true);
    }
  }, 100);
  const deadline = setTimeout(() => finish(false), LEGACY_PUSH_TIMEOUT_MS);
  provider.connect();
}
