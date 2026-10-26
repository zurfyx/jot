import { type MouseEvent, useLayoutEffect } from 'react';

import { copyNoteLink, linkCopied, startNewNote } from '../actions';
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
    <div className="example-banner" role="note" data-testid="example-banner">
      <b>Example note</b>
      <span className="example-banner-text">Ana and jot AI are demos in your browser</span>
      <span className="example-banner-actions">
        <button
          type="button"
          className="example-banner-button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copyNoteLink(session)}
        >
          <span key={String(copied)} className="swap" aria-live="polite">
            {copied ? 'Link copied' : 'Copy link'}
          </span>
        </button>
        <a className="example-banner-button" href="/new" onClick={startBlank}>
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
