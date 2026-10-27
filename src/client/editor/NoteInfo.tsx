import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { NOTE_MAX_BYTES } from '../../shared/limits';
import { colors, motion } from '../theme/tokens.stylex';
import { formatBytes, keptUntil } from './format';
import { popoverProps } from './menu';
import { peerStyle, usePeople } from './people';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/** Note info's panel, and its parts the AI model panel and blame's legend share. */
export const infoStyles = stylex.create({
  panel: {
    width: 'min(300px, calc(100vw - 24px))',
    padding: 14,
    fontSize: '13.5px',
  },
  title: {
    fontSize: 14,
    fontWeight: 650,
  },
  key: {
    marginTop: 12,
    marginInline: 0,
    marginBottom: 4,
    color: colors['--muted'],
    fontSize: 12,
    fontWeight: 500,
  },
  line: {
    margin: 0,
  },
  size: {
    display: 'flex',
    justifyContent: 'space-between',
    margin: 0,
  },
  muted: {
    color: colors['--muted'],
    fontSize: 12,
  },
  people: {
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  person: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBlock: 3,
    paddingInline: 0,
  },
  personState: {
    marginLeft: 'auto',
  },
  /** A person's colour, from the --peer their row sets (peerStyle). */
  dot: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: 9,
    height: 9,
    borderRadius: '50%',
    backgroundColor: 'var(--peer)',
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** A meter: Note info's Yjs size against the cap, and Ask AI's download. */
export const meterStyles = stylex.create({
  track: {
    height: 6,
    marginTop: 6,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: colors['--hover'],
  },
  fill: {
    display: 'block',
    height: '100%',
    backgroundColor: colors['--accent'],
    transformOrigin: 'left',
    transitionProperty: 'transform',
    transitionDuration: motion['--enter'],
    transitionTimingFunction: motion['--ease'],
  },
  ok: {},
  warn: {
    backgroundColor: colors['--warn'],
  },
  full: {
    backgroundColor: colors['--bad'],
  },
  ai: {
    backgroundColor: colors['--ai'],
  },
});

/** Note info: the Yjs size against the cap, who is here, and how long it is kept. */
export function NoteInfo({ session, viaKeyboard }: { session: NoteSession; viaKeyboard: boolean }) {
  const bytes = useSignal(session.bytes);
  const cap = useSignal(session.cap);
  const people = usePeople(session);
  const ref = useRef<HTMLDivElement>(null);
  // Opening the note counts as a visit, so it is kept 90 days from now.
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    if (viaKeyboard) {
      ref.current?.focus();
    }
  }, [viaKeyboard]);
  const share = Math.min(1, bytes / NOTE_MAX_BYTES);

  return (
    <div
      ref={ref}
      {...popoverProps(infoStyles.panel)}
      role="dialog"
      aria-label="Note info"
      tabIndex={-1}
      data-testid="note-info"
    >
      <h2 {...stylex.props(infoStyles.title)}>This note</h2>

      <h3 {...stylex.props(infoStyles.key)}>Yjs size</h3>
      <p {...stylex.props(infoStyles.size)}>
        <span data-testid="note-info-size">{formatBytes(bytes)}</span>
        <span {...stylex.props(infoStyles.muted)}>of {formatBytes(NOTE_MAX_BYTES)}</span>
      </p>
      <div
        {...stylex.props(meterStyles.track)}
        role="meter"
        aria-label="Yjs size"
        aria-valuemin={0}
        aria-valuemax={NOTE_MAX_BYTES}
        aria-valuenow={Math.min(bytes, NOTE_MAX_BYTES)}
        aria-valuetext={`${formatBytes(bytes)} of ${formatBytes(NOTE_MAX_BYTES)}`}
      >
        <span
          {...stylex.props(meterStyles.fill, meterStyles[cap])}
          style={{ transform: `scaleX(${share})` }}
        />
      </div>

      <h3 {...stylex.props(infoStyles.key)}>Here now</h3>
      <ul {...stylex.props(infoStyles.people)} data-testid="note-info-people">
        {people.map((person) => (
          <li
            key={person.clientID}
            {...stylex.props(infoStyles.person)}
            style={peerStyle(person.color)}
          >
            <span {...stylex.props(infoStyles.dot)} aria-hidden="true" />
            <span {...stylex.props(infoStyles.name)} data-testid="person-name">
              {person.name}
              {person.self ? ' (you)' : ''}
            </span>
            <span {...stylex.props(infoStyles.muted, infoStyles.personState)}>{person.state}</span>
          </li>
        ))}
      </ul>

      <h3 {...stylex.props(infoStyles.key)}>Kept until</h3>
      <p {...stylex.props(infoStyles.line)}>{keptUntil(openedAt)} · 90 days after the last visit</p>
    </div>
  );
}
