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

/** The Web Lock that keeps two tabs from claiming one draft into two notes. */
export const LEGACY_DRAFT_LOCK = 'jot:legacy-draft';

export function legacyPendingKey(id: string): string {
  return `${LEGACY_PENDING_PREFIX}${id}`;
}

export interface ClaimOptions {
  /** Defaults to `localStorage`, read inside the guard (it throws where storage is denied). */
  storage?: Storage;
  /** Defaults to `navigator.locks`; without it the claim runs unserialized. */
  locks?: Pick<LockManager, 'request'> | null;
}

/**
 * Hands a draft left by the earlier version to note `id`: it becomes that
 * note's pending copy, which a note page pushes to the relay and then clears.
 * Runs under a Web Lock and re-reads the draft inside it, so of two tabs
 * starting notes at once only one takes it. The draft is removed only once
 * the copy is written and reads back; if there is no room for it, the draft
 * stays where it is and the note opens empty. Never throws; resolves to
 * whether the draft moved.
 */
export async function claimLegacyDraft(id: string, options: ClaimOptions = {}): Promise<boolean> {
  try {
    const storage = options.storage ?? localStorage;
    // The common case, no draft at all, takes no lock.
    if (storage.getItem(LEGACY_DRAFT_KEY) === null) {
      return false;
    }
    const claim = (): boolean => {
      const draft = storage.getItem(LEGACY_DRAFT_KEY);
      if (draft === null) {
        return false;
      }
      const key = legacyPendingKey(id);
      try {
        storage.setItem(key, draft);
      } catch {
        // No room for a second copy: keep the draft for a later note.
        return false;
      }
      if (storage.getItem(key) !== draft) {
        return false;
      }
      storage.removeItem(LEGACY_DRAFT_KEY);
      return true;
    };
    const locks =
      options.locks === undefined
        ? typeof navigator === 'undefined'
          ? null
          : (navigator.locks ?? null)
        : options.locks;
    return locks === null ? claim() : await locks.request(LEGACY_DRAFT_LOCK, claim);
  } catch {
    return false;
  }
}

/**
 * A fresh note's path. A draft left by the earlier version goes into it.
 * Call it when committing to open the note, not before: a claimed draft
 * belongs to that note. Never rejects.
 */
export async function newNotePath(options?: ClaimOptions): Promise<string> {
  const id = generateNoteId();
  await claimLegacyDraft(id, options);
  return notePath(id);
}

/** ⋯ → New note, the full-note banner and Start blank: open a fresh note. */
export function startNewNote(): void {
  void newNotePath().then(navigate);
}
