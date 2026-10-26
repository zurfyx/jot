import { generateNoteId, notePath } from '../shared/ids';
import { navigate } from './router';

/**
 * Starting a note (D23), kept free of Lexical and Yjs so the landing page can
 * import it. A new note is a shared note from its first moment: it gets an id
 * here, and its page opens `/n/<id>` connected to the relay.
 */

/** The link of the landing page's start actions: it redirects to a fresh note. */
export const NEW_NOTE_PATH = '/new';

/**
 * Where an earlier version of jot kept a note nobody had shared yet (one per
 * browser), and a shared note's copy until the relay confirmed it. Nothing
 * writes them any more; editor/legacy.ts pushes what is left to the relay.
 */
export const LEGACY_DRAFT_KEY = 'jot:draft';
export const LEGACY_PENDING_PREFIX = 'jot:pending:';

export function legacyPendingKey(id: string): string {
  return `${LEGACY_PENDING_PREFIX}${id}`;
}

/**
 * Hands a draft left by the earlier version to note `id`: it becomes that
 * note's pending copy, which the note's page pushes to the relay and then
 * clears. One stored copy exists at every step: when there is no room for
 * two, the draft slot is freed first and put back if the copy still can't be
 * written. Does nothing when there is no draft.
 */
export function claimLegacyDraft(id: string, storage: Storage = localStorage): void {
  try {
    const draft = storage.getItem(LEGACY_DRAFT_KEY);
    if (draft === null) {
      return;
    }
    const key = legacyPendingKey(id);
    try {
      storage.setItem(key, draft);
      storage.removeItem(LEGACY_DRAFT_KEY);
      return;
    } catch {
      // No room for two copies.
    }
    storage.removeItem(LEGACY_DRAFT_KEY);
    try {
      storage.setItem(key, draft);
    } catch {
      storage.setItem(LEGACY_DRAFT_KEY, draft);
    }
  } catch {
    // No storage (private mode): nothing was kept to hand over.
  }
}

/** A fresh note's path. A draft left by the earlier version goes into it. */
export function newNotePath(): string {
  const id = generateNoteId();
  claimLegacyDraft(id);
  return notePath(id);
}

/** ⋯ → New note, the full-note banner and Start blank: open a fresh note. */
export function startNewNote(): void {
  navigate(newNotePath());
}
