import { Avatar } from '@astryxdesign/core/Avatar';
import { AvatarGroup, AvatarGroupOverflow } from '@astryxdesign/core/AvatarGroup';
import * as stylex from '@stylexjs/stylex';
import type { Awareness } from '@y/protocols/awareness';
import { type CSSProperties, useEffect, useState } from 'react';

import { colors, motion } from '../theme/tokens.stylex';
import { parsePeerUser } from './presence';
import type { NoteSession } from './session';

/** Someone whose caret moved this recently is "editing"; otherwise "idle". */
const EDITING_MS = 60_000;

export interface Person {
  clientID: number;
  name: string;
  color: number;
  self: boolean;
  state: 'editing' | 'idle';
}

interface Activity {
  /** When each client's caret last moved (0: not since it arrived). */
  moved: Map<number, { cursor: string; at: number }>;
}

const activities = new WeakMap<Awareness, Activity>();

/**
 * Caret movements per client, watched from the first time anyone asks (the
 * avatars mount with the page), so "editing" covers what happened before
 * Note info opened.
 */
function activityOf(awareness: Awareness): Activity {
  let activity = activities.get(awareness);
  if (activity === undefined) {
    const created: Activity = { moved: new Map() };
    const record = () => {
      const now = Date.now();
      for (const [clientID, state] of awareness.getStates()) {
        const cursor = JSON.stringify(state.cursor ?? null);
        const seen = created.moved.get(clientID);
        if (seen === undefined || seen.cursor !== cursor) {
          // A caret seen for the first time counts as idle until it moves.
          created.moved.set(clientID, { cursor, at: seen === undefined ? 0 : now });
        }
      }
      for (const clientID of created.moved.keys()) {
        if (!awareness.getStates().has(clientID)) {
          created.moved.delete(clientID);
        }
      }
    };
    record();
    // Lives as long as the awareness: destroying it drops its listeners.
    awareness.on('change', record);
    activities.set(awareness, created);
    activity = created;
  }
  return activity;
}

/** Everyone on the note now, from awareness: you first, then the others. */
export function usePeople(session: NoteSession): Person[] {
  const { awareness } = session;
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    const { moved } = activityOf(awareness);
    const update = () => {
      const now = Date.now();
      const next: Person[] = [];
      for (const [clientID, state] of awareness.getStates()) {
        const user = parsePeerUser(state.user);
        if (user === null) {
          continue;
        }
        next.push({
          clientID,
          name: user.name,
          color: user.color,
          self: clientID === awareness.clientID,
          state: now - (moved.get(clientID)?.at ?? 0) < EDITING_MS ? 'editing' : 'idle',
        });
      }
      next.sort((a, b) => Number(b.self) - Number(a.self) || a.clientID - b.clientID);
      setPeople(next);
    };
    update();
    awareness.on('change', update);
    // "editing" turns "idle" with time, not only with changes.
    const timer = setInterval(update, 15_000);
    return () => {
      awareness.off('change', update);
      clearInterval(timer);
    };
  }, [awareness]);

  return people;
}

export function peerStyle(color: number): CSSProperties {
  return { '--peer': `var(--peer-${color})` } as CSSProperties;
}

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

const MAX_AVATARS = 4;

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

// The people here: overlapping initials in their colours (`--peer`, set by
// peerStyle). Astryx's AvatarGroup overlaps them; its ring is a border, kept
// out of the layout as a shadow, and the initials' colours and type come from
// the theme's avatar-fallback override (jotTheme.ts).
const styles = stylex.create({
  avatars: {
    display: { default: 'inline-flex', '@media (max-width: 640px)': 'none' },
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    marginRight: '2px',
  },
  avatar: {
    borderWidth: 0,
    boxShadow: `0 0 0 2px ${colors['--bg']}`,
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  more: {
    minWidth: '24px',
    height: '24px',
    paddingInline: 0,
    borderWidth: 0,
    backgroundImage: 'none',
    backgroundColor: colors['--hover'],
    color: colors['--muted'],
    fontSize: '11px',
    fontWeight: 650,
    lineHeight: 1,
  },
});

/** The people here, top right: up to four circles, then "+N". */
export function Avatars({ session }: { session: NoteSession }) {
  const people = usePeople(session);
  if (people.length === 0) {
    return null;
  }
  const shown = people.slice(0, MAX_AVATARS);
  const more = people.length - shown.length;
  const names = people.map((person) => (person.self ? `${person.name} (you)` : person.name));
  return (
    <span
      {...stylex.props(styles.avatars)}
      role="img"
      aria-label={`Here now: ${names.join(', ')}`}
      data-testid="avatars"
      data-count={people.length}
    >
      <AvatarGroup size="sm">
        {shown.map((person) => (
          <Avatar
            key={person.clientID}
            name={initial(person.name)}
            tooltip={false}
            xstyle={styles.avatar}
            style={peerStyle(person.color)}
            // Astryx's props leave out `title`; the native tooltip stays.
            {...{ title: person.self ? `${person.name} (you)` : person.name }}
            data-testid="avatar"
          />
        ))}
        {more > 0 && (
          <AvatarGroupOverflow
            count={more}
            xstyle={[styles.avatar, styles.more]}
            data-testid="avatar"
          />
        )}
      </AvatarGroup>
    </span>
  );
}
