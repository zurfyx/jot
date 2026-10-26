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

export function encodeDraftState(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  let binary = '';
  for (let i = 0; i < update.length; i += 0x8000) {
    binary += String.fromCharCode(...update.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Applies a stored state to `doc`. False when it is unreadable. */
export function restoreDraftState(doc: Y.Doc, state: string): boolean {
  if (state === '') {
    return false;
  }
  try {
    const binary = atob(state);
    const update = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      update[i] = binary.charCodeAt(i);
    }
    Y.applyUpdate(doc, update, 'draft');
    return true;
  } catch {
    return false;
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
