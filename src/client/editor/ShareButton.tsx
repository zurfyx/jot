import { copyNoteLink, linkCopied, shareFailed } from './actions';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/**
 * Copies the note's link and confirms in place. On a draft it shares first:
 * the note gets its link, and the draft leaves this device (D18).
 */
export function ShareButton({ session }: { session: NoteSession }) {
  const copied = useSignal(linkCopied);
  const failed = useSignal(shareFailed);
  const noteId = useSignal(session.noteId);
  const cap = useSignal(session.cap);
  // A full draft would be refused by the server.
  const disabled = noteId === null && cap === 'full';
  const label = copied
    ? 'Link copied'
    : failed && noteId === null
      ? "Couldn't share · retry"
      : 'Share';

  return (
    <button
      type="button"
      className={`button-small ${noteId === null ? 'button-share-draft' : 'button-share'}`}
      disabled={disabled}
      title={
        failed
          ? "This browser's storage is full, so the draft couldn't be kept while it is shared. Free some space and try again."
          : undefined
      }
      onClick={() => void copyNoteLink(session)}
    >
      <span key={label} className="swap" aria-live="polite">
        {label}
      </span>
    </button>
  );
}
