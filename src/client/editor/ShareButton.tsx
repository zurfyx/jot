import { copyNoteLink, linkCopied } from './actions';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/**
 * Copies the note's link and confirms in place. On a draft it shares first:
 * the note gets its link, and the draft leaves this device (D18).
 */
export function ShareButton({ session }: { session: NoteSession }) {
  const copied = useSignal(linkCopied);
  const noteId = useSignal(session.noteId);
  const cap = useSignal(session.cap);
  // A full draft would be refused by the server.
  const disabled = noteId === null && cap === 'full';

  return (
    <button
      type="button"
      className={`button-small ${noteId === null ? 'button-share-draft' : 'button-share'}`}
      disabled={disabled}
      onClick={() => void copyNoteLink(session)}
    >
      <span key={copied ? 'copied' : 'share'} className="swap">
        {copied ? 'Link copied' : 'Share'}
      </span>
    </button>
  );
}
