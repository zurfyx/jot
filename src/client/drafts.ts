import { useSyncExternalStore } from 'react';

import { notePath } from '../shared/ids';
import { navigate, redirect } from './router';

/**
 * The page-level side of local drafts (D18), kept free of Lexical and Yjs so
 * the landing page can import it. `/new` shows the draft kept in this
 * browser; Share turns it into `/n/<id>` without remounting the editor.
 */

export const DRAFT_STORAGE_KEY = 'jot:draft';

const CHANGE_EVENT = 'jot:draft-change';

/** Bumped by "New note", so the editor remounts with an empty draft. */
let generation = 0;
/** The id the current draft was shared as: its page keeps the same editor. */
let sharedAs: string | null = null;

function changed(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearStoredDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}

/** ⋯ → New note: forget the stored draft and open an empty one. */
export function startNewDraft(): void {
  clearStoredDraft();
  generation++;
  sharedAs = null;
  if (window.location.pathname === '/new') {
    changed();
  } else {
    navigate('/new');
  }
}

/**
 * The draft became note `id`: show its link in the address bar, keeping the
 * same editor and document (no new history entry).
 */
export function adoptSharedDraft(id: string): void {
  sharedAs = id;
  redirect(notePath(id));
}

/**
 * The draft's editor unmounted (the person went elsewhere): coming back to
 * the shared link later opens it as any other note.
 */
export function releaseDraftPage(): void {
  sharedAs = null;
}

export interface DraftPage {
  /** The React key of the draft's editor: stable across its Share. */
  key: string;
  /** The note id the draft was shared as, if any. */
  sharedAs: string | null;
}

let snapshot: DraftPage = { key: 'draft-0', sharedAs: null };

function read(): DraftPage {
  const key = `draft-${generation}`;
  if (snapshot.key !== key || snapshot.sharedAs !== sharedAs) {
    snapshot = { key, sharedAs };
  }
  return snapshot;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useDraftPage(): DraftPage {
  return useSyncExternalStore(subscribe, read);
}
