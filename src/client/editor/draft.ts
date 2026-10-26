import * as Y from '@y/y';

import { DRAFT_STORAGE_KEY } from '../drafts';

/**
 * Local drafts (D18): a note nobody has shared yet lives only in this
 * browser, as its Yjs state in localStorage. Share turns it into `/n/<id>`;
 * until the relay has confirmed the content, it is kept under
 * `jot:pending:<id>` and pushed again by whichever page opens that note next.
 */

/** How long after the last change the draft is written (a debounce). */
export const DRAFT_SAVE_DEBOUNCE_MS = 500;

const PENDING_PREFIX = 'jot:pending:';

/** Where a shared note's not yet confirmed local copy is kept. */
export function pendingStorageKey(noteId: string): string {
  return `${PENDING_PREFIX}${noteId}`;
}

/**
 * A stored draft. `id` names the draft, so a page clears only the draft it
 * wrote (another tab may have stored a newer one under the same key).
 */
export interface StoredDraft {
  id: string;
  state: string;
}

function toBase64(update: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < update.length; i += 0x8000) {
    binary += String.fromCharCode(...update.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The update a stored state holds; null when it isn't base64. */
function fromBase64(state: string): Uint8Array | null {
  try {
    const binary = atob(state);
    const update = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      update[i] = binary.charCodeAt(i);
    }
    return update;
  } catch {
    return null;
  }
}

export function encodeDraftState(doc: Y.Doc): string {
  return toBase64(Y.encodeStateAsUpdate(doc));
}

/** Applies a stored state to `doc`. False when it is unreadable. */
export function restoreDraftState(doc: Y.Doc, state: string): boolean {
  const update = state === '' ? null : fromBase64(state);
  if (update === null) {
    return false;
  }
  try {
    Y.applyUpdate(doc, update, 'draft');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether applying `state` to `doc` would change it: false when the stored
 * copy holds nothing the document lacks (inserts and deletes alike), so it
 * is safe to drop once the document is confirmed. Checked on a copy, so
 * `doc` is untouched. An unreadable state changes nothing.
 */
export function draftStateAddsTo(doc: Y.Doc, state: string): boolean {
  const update = fromBase64(state);
  if (update === null || update.length === 0) {
    return false;
  }
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    let changed = false;
    copy.on('update', () => {
      changed = true;
    });
    Y.applyUpdate(copy, update);
    if (changed) {
      return true;
    }
    // Content that could not be integrated would not show as a change.
    const known = Y.decodeStateVector(Y.encodeStateVector(copy));
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))) {
      if ((known.get(client) ?? 0) < clock) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    copy.destroy();
  }
}

/**
 * The state to store for `doc` over what is stored now: a merge with the
 * stored copy when it is the same draft (another tab, or another page on the
 * same note, may have written newer edits), so a write never drops them.
 */
export function mergedDraftState(doc: Y.Doc, stored: StoredDraft | null, id: string): string {
  const own = Y.encodeStateAsUpdate(doc);
  const theirs = stored !== null && stored.id === id ? fromBase64(stored.state) : null;
  if (theirs === null || theirs.length === 0) {
    return toBase64(own);
  }
  try {
    return toBase64(Y.mergeUpdates([theirs as Uint8Array<ArrayBuffer>, own]));
  } catch {
    return toBase64(own);
  }
}

/** Parses what `writeDraft` stored; null for nothing or something else. */
export function parseDraft(stored: string | null): StoredDraft | null {
  if (stored === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value === 'object' && value !== null) {
      const { id, state } = value as Record<string, unknown>;
      if (typeof id === 'string' && typeof state === 'string') {
        return { id, state };
      }
    }
  } catch {
    // Not a stored draft.
  }
  return null;
}

export function readDraft(key: string = DRAFT_STORAGE_KEY): StoredDraft | null {
  try {
    return parseDraft(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** False when the browser refused (private mode, quota). */
export function writeDraft(key: string, draft: StoredDraft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Removes the draft at `key`, only if it is still draft `id`. */
export function removeDraft(key: string, id: string): void {
  try {
    if (readDraft(key)?.id === id) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing to remove.
  }
}

/**
 * Removes the draft at `key` only while it is exactly `expected` (the
 * stored string this page checked), so a newer write from another page is
 * never dropped.
 */
export function removeDraftIfUnchanged(key: string, expected: string): void {
  try {
    if (localStorage.getItem(key) === expected) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing to remove.
  }
}

export function readRawDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Moves draft `draft` from `from` to `to`, keeping one stored copy at every
 * step. When there is no room for two copies (a large draft near the
 * storage quota), it frees `from` and tries again, and puts `from` back if
 * that fails too. Returns whether `to` now holds the draft.
 */
export function moveDraft(from: string, to: string, draft: StoredDraft): boolean {
  if (writeDraft(to, draft)) {
    removeDraft(from, draft.id);
    return true;
  }
  const previous = readRawDraft(from);
  if (previous === null || parseDraft(previous)?.id !== draft.id) {
    return false;
  }
  try {
    localStorage.removeItem(from);
  } catch {
    return false;
  }
  if (writeDraft(to, draft)) {
    return true;
  }
  try {
    localStorage.setItem(from, previous);
  } catch {
    // The page still holds the draft; the next save tries again.
  }
  return false;
}
