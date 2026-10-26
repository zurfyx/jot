import { signal } from '@lexical/extension';

import type { NoteSession } from './session';

export { startNewNote } from '../notes';

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
 * Share, Copy link and ⌘⇧C: copy the note's link and say so for a moment.
 */
export async function copyNoteLink(session: NoteSession): Promise<boolean> {
  if (!(await copyText(session.link()))) {
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
