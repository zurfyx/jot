import { createYDoc } from '@lexical/y';
import * as Y from '@y/y';

import { UNKNOWN_GENERATION } from '../../shared/fence';
import { isNoteId } from '../../shared/ids';
import { LEGACY_PENDING_PREFIX } from '../notes';
import { sessionId, uploadMaterial } from './handoff';
import { captureLegacyCopy, offlineStore } from './offline';

/**
 * The migration from local drafts (D23). An earlier version of jot kept
 * notes in localStorage: an unshared draft under `jot:draft` (notes.ts hands
 * it to the next new note) and, for a note shared moments before its tab
 * closed, a copy under `jot:pending:<id>` until the relay confirmed it. Each
 * copy left goes to its note's offline edits: a capture on this device
 * (D37), or, without a store here, a record of the note (D34). It is cleared
 * once stored, acknowledged, or refused for good.
 */

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
    const doc = createYDoc();
    try {
      Y.applyUpdate(doc, update);
    } finally {
      doc.destroy();
    }
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
      void pushCopy(id);
    }
  }
}

/** Upload attempts per page before a copy waits for the next note page. */
export const LEGACY_PUSH_ATTEMPTS = 4;

/**
 * Hands one copy to its note's offline edits. A copy from an earlier jot has
 * no generation the note can check (it may even be from an earlier life of
 * the note, before it expired and was created again), so it is never merged
 * into the note: it becomes a capture on this device (D37), listed under ⋯ →
 * Offline edits, and is removed from localStorage once stored. Without a
 * store here it is uploaded as a record of its own (D34), removed once the
 * server acknowledges it or refuses it for good (malformed, too large, the
 * note keeps too many); one that could not reach the server waits for the
 * next note page.
 */
async function pushCopy(id: string): Promise<void> {
  const key = `${LEGACY_PENDING_PREFIX}${id}`;
  const stored = readStored(key);
  const update = isNoteId(id) ? parseLegacyCopy(stored) : null;
  if (update === null) {
    // Not a note's copy, or unreadable: nothing to push.
    removeStored(key, stored);
    return;
  }
  pushing.add(id);
  try {
    const { store } = await offlineStore();
    if (await captureLegacyCopy(store, id, update)) {
      removeStored(key, stored);
      return;
    }
    const { result } = await uploadMaterial(
      id,
      {
        session: sessionId(),
        replica: 'copy',
        source: {
          incarnation: null,
          generation: UNKNOWN_GENERATION,
          layouts: null,
          schemaVersion: null,
          renderer: null,
        },
        snapshot: update,
        queue: [],
        draft: null,
        clients: [],
        // Unknown provenance: anything may have reached that copy.
        peers: true,
      },
      undefined,
      LEGACY_PUSH_ATTEMPTS,
    );
    if (result !== 'later') {
      removeStored(key, stored);
    }
  } finally {
    pushing.delete(id);
  }
}
