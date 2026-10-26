import { signal } from '@lexical/extension';

import { adoptSharedDraft, startNewDraft } from '../drafts';
import type { NoteSession } from './session';

/** True for a moment after a link was copied: Share says "Link copied". */
export const linkCopied = signal(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/**
 * Share, Copy link and ⌘⇧C. A draft is shared first (D18): it gets an id and
 * a provider, and the address bar moves to `/n/<id>` with the same editor.
 * The link is copied in the same task as the click, while the page still
 * holds the user's activation.
 */
export async function copyNoteLink(session: NoteSession): Promise<boolean> {
  if (session.noteId.peek() === null) {
    adoptSharedDraft(session.share());
  }
  const link = session.link();
  if (link === null || !(await copyText(link))) {
    return false;
  }
  linkCopied.value = true;
  if (copiedTimer !== null) {
    clearTimeout(copiedTimer);
  }
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    linkCopied.value = false;
  }, 1800);
  return true;
}

/** ⋯ → New note: an empty draft at /new. */
export function startNewNote(session: NoteSession): void {
  session.forgetDraft();
  startNewDraft();
}
