import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react';

import { notePath } from '../../shared/ids';
import {
  openedLabel,
  RECENT_ROWS_VAR,
  RECENT_ROWS_WIDE_VAR,
  RECENT_SHOWN,
  type RecentNote,
  recentNotes,
  reservedRows,
  useRecentNotes,
} from '../recent';
import { colors } from '../theme/tokens.stylex';
import { recentMarker } from './markers.stylex';
import { section } from './section.styles';

/*
 * "Your recent notes" (D30), right below the hero: the notes this browser
 * opened, newest first, in two columns of hairline rows (one on a phone).
 *
 * The section is a slot of a fixed height: index.html marks <html> before the
 * first paint with whether there are entries and how many rows they take, and
 * a global rule hides the slot when there are none. A prerendered page (whose
 * snapshot is empty) and the client's first paint so lay out the same, and
 * with no recent notes the landing page is exactly what it was.
 */

const NARROW = '@media (max-width: 760px)';
const ROW = 60;
const HEAD = 32;
const FOOT = 44;
// RECENT_ROWS_VAR and RECENT_ROWS_WIDE_VAR, spelled out: StyleX compiles only local values.
const ROWS = 'var(--jot-recent-rows, 0)';
const ROWS_WIDE = 'var(--jot-recent-rows-wide, 0)';

const styles = stylex.create({
  section: {
    height: {
      default: `calc(8px + ${HEAD}px + ${ROWS_WIDE} * ${ROW}px + ${FOOT}px)`,
      [NARROW]: `calc(36px + ${HEAD}px + ${ROWS} * ${ROW}px + ${FOOT}px)`,
    },
    paddingTop: {
      default: 8,
      [NARROW]: 36,
    },
  },
  head: {
    height: HEAD,
    marginBottom: 0,
    lineHeight: `${HEAD}px`,
  },
  list: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(0, 1fr)',
      [NARROW]: 'minmax(0, 1fr)',
    },
    gridTemplateRows: {
      default: `repeat(${ROWS_WIDE}, ${ROW}px)`,
      [NARROW]: `repeat(${ROWS}, ${ROW}px)`,
    },
    columnGap: 40,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: ROW,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors['--rule'],
  },
  link: {
    display: 'block',
    flexGrow: 1,
    minWidth: 0,
    paddingBlock: 6,
    color: colors['--ink'],
    textDecorationLine: 'none',
    outlineOffset: {
      default: null,
      ':focus-visible': 2,
    },
    borderRadius: 6,
  },
  title: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 650,
    textDecorationLine: {
      default: 'none',
      [stylex.when.ancestor(':hover', recentMarker)]: 'underline',
    },
    textDecorationColor: colors['--rule-strong'],
    textUnderlineOffset: '0.2em',
  },
  excerpt: {
    display: 'block',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: colors['--muted'],
    fontSize: '13.5px',
  },
  meta: {
    flexShrink: 0,
    marginRight: {
      default: 0,
      '@media (hover: none)': 32,
    },
    color: colors['--muted'],
    fontSize: 13,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    opacity: {
      default: 1,
      [stylex.when.ancestor(':hover', recentMarker)]: 0,
      [stylex.when.ancestor(':focus-within', recentMarker)]: 0,
      '@media (hover: none)': 1,
    },
  },
  remove: {
    position: 'absolute',
    right: 0,
    display: 'grid',
    placeItems: 'center',
    width: 26,
    height: 26,
    borderRadius: '50%',
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
    backgroundColor: {
      default: null,
      ':hover': colors['--hover'],
      ':focus-visible': colors['--hover'],
    },
    cursor: 'pointer',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', recentMarker)]: 1,
      [stylex.when.ancestor(':focus-within', recentMarker)]: 1,
      '@media (hover: none)': 1,
    },
  },
  removeIcon: {
    width: 10,
    height: 10,
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    height: FOOT,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors['--rule'],
    color: colors['--muted'],
    fontSize: 13,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    marginRight: -6,
  },
  quiet: {
    paddingBlock: 4,
    paddingInline: 6,
    borderRadius: 6,
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  confirm: {
    color: {
      default: colors['--bad'],
      ':hover': colors['--bad'],
    },
  },
});

export type OpenRecent = (entry: RecentNote, element: HTMLElement | null) => void;

function RemoveIcon() {
  return (
    <svg {...stylex.props(styles.removeIcon)} viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The section right below the hero; renders nothing inside its slot without entries. */
export function RecentNotes({ onOpen }: { onOpen: OpenRecent }) {
  const notes = useRecentNotes();
  const [all, setAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [now] = useState(Date.now);
  const listRef = useRef<HTMLUListElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusRow = useRef<number | null>(null);

  const shown = all ? notes : notes.slice(0, RECENT_SHOWN);
  const [rows, wide] = all
    ? [shown.length, Math.ceil(shown.length / 2)]
    : reservedRows(notes.length);

  // After a removal, the focus goes to the row that took its place.
  useEffect(() => {
    if (focusRow.current === null) {
      return;
    }
    const links = listRef.current?.querySelectorAll<HTMLElement>('[data-recent-link]') ?? [];
    links[Math.min(focusRow.current, links.length - 1)]?.focus();
    focusRow.current = null;
  }, [notes]);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    }
  }, [confirming]);

  // The slot's rows follow what it shows; before the first render they come from <html>.
  const style =
    notes.length > 0
      ? ({ [RECENT_ROWS_VAR]: rows, [RECENT_ROWS_WIDE_VAR]: wide } as CSSProperties)
      : undefined;

  return (
    <section
      {...stylex.props(section.section, styles.section)}
      style={style}
      aria-labelledby={notes.length > 0 ? 'recent-title' : undefined}
      data-recent-slot=""
      data-testid="recent-notes"
    >
      {notes.length > 0 && (
        <>
          <h2 id="recent-title" {...stylex.props(section.eyebrow, styles.head)}>
            Your recent notes
          </h2>
          <ul ref={listRef} {...stylex.props(styles.list)}>
            {shown.map((entry, index) => (
              <Row
                key={entry.id}
                entry={entry}
                now={now}
                onOpen={onOpen}
                onRemove={() => {
                  focusRow.current = index;
                  recentNotes.remove(entry.id);
                }}
              />
            ))}
          </ul>
          <div
            {...stylex.props(styles.foot)}
            onKeyDown={(event) => {
              if (confirming && event.key === 'Escape') {
                setConfirming(false);
              }
            }}
          >
            {confirming ? (
              <>
                <span role="status">Clear all {notes.length} recent notes?</span>
                <span {...stylex.props(styles.actions)}>
                  <button
                    ref={confirmRef}
                    type="button"
                    {...stylex.props(styles.quiet, styles.confirm)}
                    onClick={() => {
                      setConfirming(false);
                      setAll(false);
                      recentNotes.clear();
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    {...stylex.props(styles.quiet)}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </span>
              </>
            ) : (
              <>
                <span>Only in this browser</span>
                <span {...stylex.props(styles.actions)}>
                  {!all && notes.length > RECENT_SHOWN && (
                    <button
                      type="button"
                      {...stylex.props(styles.quiet)}
                      onClick={() => setAll(true)}
                    >
                      Show all {notes.length}
                    </button>
                  )}
                  <button
                    type="button"
                    {...stylex.props(styles.quiet)}
                    onClick={() => setConfirming(true)}
                  >
                    Clear all
                  </button>
                </span>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Row({
  entry,
  now,
  onOpen,
  onRemove,
}: {
  entry: RecentNote;
  now: number;
  onOpen: OpenRecent;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const opened = openedLabel(entry.openedAt, now);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onOpen(entry, ref.current);
  };
  return (
    <li ref={ref} {...stylex.props(styles.row, recentMarker)} data-testid="recent-note">
      <a
        {...stylex.props(styles.link)}
        href={notePath(entry.id)}
        onClick={onClick}
        data-recent-link=""
      >
        <span {...stylex.props(styles.title)}>{entry.title}</span>
        {entry.excerpt !== '' && <span {...stylex.props(styles.excerpt)}>{entry.excerpt}</span>}
      </a>
      <span {...stylex.props(styles.meta)}>{entry.example ? `Example · ${opened}` : opened}</span>
      <button
        type="button"
        {...stylex.props(styles.remove)}
        aria-label={`Remove ${entry.title} from recent notes`}
        title="Remove from recent notes"
        onClick={onRemove}
      >
        <RemoveIcon />
      </button>
    </li>
  );
}
