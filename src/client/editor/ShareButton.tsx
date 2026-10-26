import { copyNoteLink, linkCopied } from './actions';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/** Copies the note's link and confirms in place. */
export function ShareButton({ session }: { session: NoteSession }) {
  const copied = useSignal(linkCopied);
  const label = copied ? 'Link copied' : 'Share';

  return (
    <button
      type="button"
      className="button-small button-share"
      onClick={() => void copyNoteLink(session)}
    >
      <span key={label} className="swap" aria-live="polite">
        {label}
      </span>
    </button>
  );
}
