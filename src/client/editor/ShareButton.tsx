import * as stylex from '@stylexjs/stylex';

import { colors } from '../theme/tokens.stylex';
import { copyNoteLink, linkCopied } from './actions';
import { buttonSmall, swap } from './chrome.styles';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

const styles = stylex.create({
  share: {
    fontWeight: 500,
    backgroundColor: { default: null, ':hover': colors['--hover'] },
  },
});

/** Copies the note's link and confirms in place. */
export function ShareButton({ session }: { session: NoteSession }) {
  const copied = useSignal(linkCopied);
  const label = copied ? 'Link copied' : 'Share';

  return (
    <button
      type="button"
      {...stylex.props(buttonSmall.base, styles.share)}
      onClick={() => void copyNoteLink(session)}
    >
      <span key={label} {...stylex.props(swap.label)} aria-live="polite">
        {label}
      </span>
    </button>
  );
}
