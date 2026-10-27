import * as stylex from '@stylexjs/stylex';
import { type MouseEvent, useLayoutEffect } from 'react';

import { colors, motion } from '../../theme/tokens.stylex';
import { copyNoteLink, linkCopied, startNewNote } from '../actions';
import { swap } from '../chrome.styles';
import { MenuItem } from '../menu';
import type { NoteSession } from '../session';
import { useSignal } from '../useSignal';
import { exampleState } from './controller';

/**
 * Starts the example's demo collaborators on the page that created it, and
 * stops them on leaving. A layout effect, so on unmount it stops them before
 * the page's own (passive) cleanup closes the socket: their departure is
 * relayed to everyone first.
 */
export function ExampleSurface({ session }: { session: NoteSession }) {
  useLayoutEffect(() => exampleState(session).start(), [session]);
  return null;
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

// The example note's banner, above the title (D20).
const styles = stylex.create({
  banner: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: '4px',
    columnGap: '8px',
    width: 'max-content',
    maxWidth: '100%',
    marginTop: 0,
    marginInline: 0,
    marginBottom: '18px',
    paddingTop: '5px',
    paddingRight: '6px',
    paddingBottom: '5px',
    paddingLeft: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: '12px',
    backgroundColor: colors['--bg'],
    boxShadow: `0 6px 18px ${colors['--shadow-soft']}`,
    fontSize: '13px',
    lineHeight: 1.4,
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  title: {
    color: colors['--ink'],
    fontWeight: 650,
  },
  text: {
    color: colors['--muted'],
  },
  actions: {
    display: 'inline-flex',
    gap: '6px',
  },
  // A button and a link, alike (the reset gives the button the banner's font).
  button: {
    paddingBlock: '6px',
    paddingInline: '9px',
    borderRadius: '8px',
    backgroundColor: { default: colors['--hover'], ':hover': colors['--rule'] },
    color: colors['--ink'],
    fontSize: '12.5px',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
  },
});

/** Above the title, in the tab that runs the demo collaborators. */
export function ExampleBanner({ session }: { session: NoteSession }) {
  const active = useSignal(exampleState(session).active);
  const copied = useSignal(linkCopied);
  if (!active) {
    return null;
  }
  const startBlank = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    startNewNote();
  };
  return (
    <div
      {...stylex.props(styles.banner)}
      role="note"
      data-testid="example-banner"
      data-own-press=""
    >
      <b {...stylex.props(styles.title)}>Example note</b>
      <span {...stylex.props(styles.text)}>Ana and jot AI are demos in your browser</span>
      <span {...stylex.props(styles.actions)}>
        <button
          type="button"
          {...stylex.props(styles.button)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copyNoteLink(session)}
        >
          <span key={String(copied)} {...stylex.props(swap.label)} aria-live="polite">
            {copied ? 'Link copied' : 'Copy link'}
          </span>
        </button>
        <a {...stylex.props(styles.button)} href="/new" onClick={startBlank}>
          Start blank
        </a>
      </span>
    </div>
  );
}

/** ⋯ → Replay demo, in the tab that runs the demo collaborators. */
export function ReplayDemoItem({ session, close }: { session: NoteSession; close: () => void }) {
  const state = exampleState(session);
  const active = useSignal(state.active);
  const writable = useSignal(state.writable);
  if (!active) {
    return null;
  }
  return (
    <MenuItem
      icon="replay"
      label="Replay demo"
      testId="replay-demo"
      disabled={!writable}
      onSelect={() => {
        close();
        state.replay();
      }}
    />
  );
}
