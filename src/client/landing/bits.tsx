/** Small drawing pieces shared by the landing page's illustrations. */

import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { colors, landing } from '../theme/tokens.stylex';

export type Who = 'you' | 'ana' | 'ai';

/*
 * Whose colour a piece draws in: `--who`, inherited, so a piece's parts (a
 * caret's name, a step's bar) read it too.
 */
export const who = stylex.create({
  you: { '--who': landing['--you'] },
  ana: { '--who': landing['--ana'] },
  ai: { '--who': colors['--ai'] },
  accent: { '--who': colors['--accent'] },
});

const styles = stylex.create({
  caret: {
    position: 'relative',
    display: 'inline-block',
    width: 2,
    height: '1.15em',
    marginBlock: 0,
    marginInline: 1,
    verticalAlign: '-3px',
    backgroundColor: 'var(--who)',
  },
  caretName: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    paddingBlock: 3,
    paddingInline: 5,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 0,
    backgroundColor: 'var(--who)',
    color: colors['--peer-ink'],
    fontSize: '10.5px',
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  by: {
    textDecorationLine: 'underline',
    textDecorationThickness: 2,
    textDecorationColor: 'color-mix(in srgb, var(--who) 70%, transparent)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: 4,
  },
  check: {
    display: 'inline-block',
    width: 13,
    height: 13,
    marginRight: 6,
    verticalAlign: '-1px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: colors['--muted'],
    borderRadius: 3,
  },
  checkDone: {
    borderColor: colors['--accent'],
    backgroundColor: colors['--accent'],
  },
  avatars: {
    display: 'flex',
    marginLeft: 'auto',
  },
  avatar: {
    width: 22,
    height: 22,
    marginLeft: -6,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: landing['--card'],
    borderRadius: '50%',
    backgroundColor: 'var(--who)',
    color: colors['--peer-ink'],
    fontSize: 10,
    fontWeight: 700,
    lineHeight: '18px',
    textAlign: 'center',
  },
});

/** A person's caret (yours unless `who` says otherwise), with a name when given. */
export function Caret({
  who: person = 'you',
  name,
  xstyle,
}: {
  who?: Who;
  name?: string;
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <span {...stylex.props(styles.caret, who[person], xstyle)} aria-hidden="true">
      {name !== undefined && <span {...stylex.props(styles.caretName)}>{name}</span>}
    </span>
  );
}

/** Text underlined in its author's colour, as blame shows it. */
export function By({ who: person, children }: { who: Who; children: ReactNode }) {
  return <span {...stylex.props(styles.by, who[person])}>{children}</span>;
}

export function Check({ done = false }: { done?: boolean }) {
  return <span {...stylex.props(styles.check, done && styles.checkDone)} aria-hidden="true" />;
}

type IconProps = { xstyle?: stylex.StyleXStyles };

export function SparkleIcon({ xstyle }: IconProps) {
  return (
    <svg {...stylex.props(xstyle)} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor" />
    </svg>
  );
}

export function OpenIcon({ xstyle }: IconProps) {
  return (
    <svg {...stylex.props(xstyle)} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 12L12 4M6 4h6v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LinkIcon({ xstyle }: IconProps) {
  return (
    <svg {...stylex.props(xstyle)} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Overlapping avatars: an initial (or the AI's sparkle) on the person's colour. */
export function Avatars({ people }: { people: [Who, string][] }) {
  return (
    <span {...stylex.props(styles.avatars)} aria-hidden="true">
      {people.map(([person, initial]) => (
        <span key={person} {...stylex.props(styles.avatar, who[person])}>
          {initial}
        </span>
      ))}
    </span>
  );
}
