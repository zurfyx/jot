import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react';

import { colors, motion } from '../../theme/tokens.stylex';

import { ago } from '../format';
import { MenuToggle, moveMenuFocus, useFocusFirstItem, usePopover } from '../menu';
import { peerStyle } from '../people';
import { localUser } from '../presence';
import type { NoteSession } from '../session';
import { useSignal } from '../useSignal';
import { type BlameSnapshot, computeBlame } from './attribution';
import { createPainter } from './highlights';
import { marginGroups, type PaintPlan, planPaint, spanAt } from './paint';
import { type BlamePerson, localPersonId, trackLocalPerson } from './registry';
import { debounceWithMaxWait } from './schedule';
import { blameState } from './state';

/** Recompute this long after the last document update, while blame shows. */
export const BLAME_DEBOUNCE_MS = 150;
/** ...and at least this often while updates keep coming (someone typing). */
export const BLAME_MAX_WAIT_MS = 1000;

const self = { id: '' };
function isSelf(person: BlamePerson): boolean {
  if (self.id === '') {
    self.id = localPersonId();
  }
  return person.id === self.id;
}

/** How blame names someone: "You" for this browser's person. */
export function displayName(person: BlamePerson): string {
  return isSelf(person) ? 'You' : person.name;
}

function percent(chars: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((chars / total) * 100)}%`;
}

/** ⋯ → Show blame. */
export function BlameMenuToggle({ session }: { session: NoteSession }) {
  const state = blameState(session);
  const on = useSignal(state.on);
  return (
    <MenuToggle
      icon="eye"
      label="Show blame"
      checked={on}
      onChange={(value) => state.setOn(value)}
    />
  );
}

/** The "Blame ●●●" chip in the dock while blame shows, and its legend. */
export function BlameChip({ session }: { session: NoteSession }) {
  const state = blameState(session);
  const visible = useSignal(state.visible);
  const snapshot = useSignal(state.snapshot);
  const slotRef = useRef<HTMLSpanElement>(null);
  const { open, viaKeyboard, close, toggle } = usePopover<'legend'>(slotRef, () => {
    if (slotRef.current?.contains(document.activeElement)) {
      session.editor.focus();
    }
  });
  useEffect(() => {
    if (!visible && open !== null) {
      close();
    }
  }, [visible, open, close]);
  if (!visible) {
    return null;
  }
  const dots = snapshot.shares.slice(0, 4);
  return (
    <span ref={slotRef} className="blame-slot">
      <button
        type="button"
        className="dock-button blame-chip"
        aria-haspopup="menu"
        aria-expanded={open === 'legend'}
        title="Blame: who wrote what"
        data-testid="blame-chip"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => toggle('legend', event.detail)}
      >
        Blame
        {dots.length > 0 && (
          <span className="blame-dots" aria-hidden="true">
            {dots.map(({ person }) => (
              <i key={person.id} style={peerStyle(person.color)} />
            ))}
          </span>
        )}
      </button>
      {open === 'legend' && (
        <BlameLegend
          session={session}
          snapshot={snapshot}
          viaKeyboard={viaKeyboard}
          close={close}
        />
      )}
    </span>
  );
}

function BlameLegend({
  session,
  snapshot,
  viaKeyboard,
  close,
}: {
  session: NoteSession;
  snapshot: BlameSnapshot;
  viaKeyboard: boolean;
  close: () => void;
}) {
  const state = blameState(session);
  const focus = useSignal(state.focus);
  const ref = useRef<HTMLDivElement>(null);
  useFocusFirstItem(ref, viaKeyboard);
  return (
    <div
      ref={ref}
      className="popover blame-legend"
      role="menu"
      aria-label="Blame"
      data-testid="blame-legend"
      onKeyDown={moveMenuFocus}
      onMouseDown={(event) => event.preventDefault()}
    >
      {snapshot.shares.length === 0 && <p className="blame-empty">Nobody has written here yet.</p>}
      {snapshot.shares.map(({ person, chars }) => (
        <button
          key={person.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={focus === person.id}
          tabIndex={-1}
          className="menu-item blame-person"
          style={peerStyle(person.color)}
          title={person.name}
          data-testid="blame-person"
          data-person={person.id}
          onClick={() => {
            state.setFocus(focus === person.id ? null : person.id);
          }}
        >
          <span className="person-dot" aria-hidden="true" />
          <span className="menu-label person-name">{displayName(person)}</span>
          <span className="menu-hint" data-testid="blame-share">
            {percent(chars, snapshot.total)}
          </span>
        </button>
      ))}
      <div className="blame-legend-foot">
        <span>Click a name to focus</span>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="blame-hide"
          onClick={() => {
            state.setOn(false);
            close();
          }}
        >
          Hide blame
        </button>
      </div>
    </div>
  );
}

/**
 * Over the note's surface: keeps this session's registry entry, flashes blame
 * after reconnecting from Work offline, and, only while blame shows, paints
 * it.
 */
export function BlameSurface({
  session,
  surfaceRef,
}: {
  session: NoteSession;
  surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const state = blameState(session);
  const visible = useSignal(state.visible);

  useEffect(() => trackLocalPerson(session.doc, localUser), [session]);
  useEffect(
    () =>
      session.onReconnect(({ afterWorkOffline }) => {
        if (afterWorkOffline) {
          state.flash();
        }
      }),
    [session, state],
  );

  return visible ? <BlameLayer session={session} surfaceRef={surfaceRef} /> : null;
}

interface Bar {
  key: string;
  person: BlamePerson;
  top: number;
  height: number;
  named: boolean;
}

interface Card {
  person: BlamePerson;
  askedBy: BlamePerson | null;
  x: number;
  y: number;
}

const surfaceFadeIn = stylex.keyframes({ from: { opacity: 0 } });

// Blame over the note's surface: the margin's bars and names, and the hover
// card. Each person's colour is `--peer`, set by peerStyle.
const surfaceStyles = stylex.create({
  margin: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    animationName: surfaceFadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  // Under 640px, no room for names beside the column: bars only, in the padding.
  run: {
    position: 'absolute',
    left: { default: '-22px', '@media (max-width: 640px)': '-12px' },
    width: '3px',
    borderRadius: '2px',
    backgroundColor: 'var(--peer)',
    transitionProperty: 'opacity',
    transitionDuration: motion['--enter'],
    transitionTimingFunction: motion['--ease'],
  },
  runFaded: {
    opacity: colors['--blame-faded-opacity'],
  },
  // Names need the margin beside the column; narrower windows keep the bars.
  name: {
    position: 'absolute',
    top: '3px',
    right: '14px',
    display: { default: null, '@media (max-width: 900px)': 'none' },
    width: '88px',
    overflow: 'hidden',
    color: 'var(--peer)',
    fontSize: '11.5px',
    fontWeight: 600,
    lineHeight: 1.4,
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  card: {
    position: 'fixed',
    zIndex: 30,
    display: 'flex',
    maxWidth: 'min(320px, calc(100vw - 16px))',
    flexDirection: 'column',
    gap: '2px',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: '10px',
    backgroundColor: colors['--bg'],
    boxShadow: `0 10px 28px ${colors['--shadow-soft']}`,
    color: colors['--ink'],
    fontSize: '13px',
    lineHeight: 1.4,
    pointerEvents: 'none',
    animationName: surfaceFadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  cardName: {
    fontWeight: 600,
  },
  cardDetails: {
    color: colors['--muted'],
    fontSize: '12px',
  },
});

/** Minimum gap between two names in the margin, in px. */
const NAME_GAP = 18;

function BlameLayer({
  session,
  surfaceRef,
}: {
  session: NoteSession;
  surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const state = blameState(session);
  const focus = useSignal(state.focus);
  const [bars, setBars] = useState<Bar[]>([]);
  const [card, setCard] = useState<Card | null>(null);

  useEffect(() => {
    const { doc, editor } = session;
    const painter = createPainter();
    let plan: PaintPlan | null = null;
    let snapshot: BlameSnapshot | null = null;
    let order: BlamePerson[] = [];
    let frame = 0;
    let stopped = false;

    const layout = () => {
      frame = 0;
      const surface = surfaceRef.current;
      if (stopped || surface === null || plan === null || snapshot === null) {
        return;
      }
      const people = snapshot.people;
      let lastName = -Infinity;
      const next: Bar[] = [];
      // Cells side by side start at one height: Gerard, Ana, Gerard in a table
      // row are three groups, two of them Gerard's at the same top.
      const seen = new Map<string, number>();
      for (const group of marginGroups(plan.lines, surface.getBoundingClientRect())) {
        const person = people.get(group.author);
        if (person === undefined) {
          continue;
        }
        const named = group.top >= lastName + NAME_GAP;
        if (named) {
          lastName = group.top;
        }
        const base = `${group.author}:${Math.round(group.top)}`;
        const repeat = seen.get(base) ?? 0;
        seen.set(base, repeat + 1);
        next.push({ key: repeat === 0 ? base : `${base}:${repeat}`, person, ...group, named });
      }
      setBars(next);
    };
    const scheduleLayout = () => {
      if (frame === 0 && !stopped) {
        frame = requestAnimationFrame(layout);
      }
    };
    const paint = () => {
      if (plan !== null) {
        painter.paint(order, plan.ranges, state.focus.peek());
      }
    };
    const compute = () => {
      if (stopped) {
        return;
      }
      snapshot = computeBlame(doc);
      // Highlight names follow the legend's order, so N is stable while shares are.
      order = snapshot.shares.map(({ person }) => person);
      state.setSnapshot(snapshot);
      plan = planPaint(editor, snapshot);
      paint();
      scheduleLayout();
    };
    const debounced = debounceWithMaxWait(compute, BLAME_DEBOUNCE_MS, BLAME_MAX_WAIT_MS);
    const scheduleCompute = () => debounced.schedule();

    compute();
    doc.on('update', scheduleCompute);
    const stopFocus = state.focus.subscribe(paint);
    const resize = new ResizeObserver(scheduleLayout);
    window.addEventListener('resize', scheduleLayout);

    // The hover card: what is under the pointer, checked once per frame.
    let pointer: { x: number; y: number } | null = null;
    let hoverFrame = 0;
    const hover = () => {
      hoverFrame = 0;
      const at = pointer;
      if (stopped || at === null || plan === null || snapshot === null) {
        setCard(null);
        return;
      }
      let found: string | null = null;
      try {
        found = attributedAt(plan, at.x, at.y);
      } catch {
        // A point blame cannot resolve shows no card.
      }
      const person = found === null ? undefined : snapshot.people.get(found);
      if (person === undefined) {
        setCard((current) => (current === null ? current : null));
        return;
      }
      const askedBy =
        person.kind === 'ai' && person.askedBy !== undefined
          ? (snapshot.people.get(person.askedBy) ?? null)
          : null;
      setCard({ person, askedBy, x: at.x, y: at.y });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        return;
      }
      pointer = { x: event.clientX, y: event.clientY };
      if (hoverFrame === 0) {
        hoverFrame = requestAnimationFrame(hover);
      }
    };
    const onPointerLeave = () => {
      pointer = null;
      setCard(null);
    };
    const stopRoot = editor.registerRootListener((root, previous) => {
      if (previous !== null) {
        resize.unobserve(previous);
        previous.removeEventListener('pointermove', onPointerMove);
        previous.removeEventListener('pointerleave', onPointerLeave);
      }
      if (root !== null) {
        resize.observe(root);
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerleave', onPointerLeave);
      }
    });
    const onScroll = () => setCard(null);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      stopped = true;
      debounced.cancel();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hoverFrame);
      doc.off('update', scheduleCompute);
      stopFocus();
      resize.disconnect();
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('scroll', onScroll);
      stopRoot();
      const root = editor.getRootElement();
      root?.removeEventListener('pointermove', onPointerMove);
      root?.removeEventListener('pointerleave', onPointerLeave);
      painter.clear();
    };
  }, [session, state, surfaceRef]);

  return (
    <>
      <div {...stylex.props(surfaceStyles.margin)} aria-hidden="true" data-testid="blame-margin">
        {bars.map((bar) => {
          const faded = focus !== null && focus !== bar.person.id;
          return (
            <div
              key={bar.key}
              {...stylex.props(surfaceStyles.run, faded && surfaceStyles.runFaded)}
              style={{ ...peerStyle(bar.person.color), top: bar.top, height: bar.height }}
              data-testid="blame-run"
              data-faded={faded ? '' : undefined}
            >
              {bar.named && (
                <span {...stylex.props(surfaceStyles.name)} data-testid="blame-name">
                  {displayName(bar.person)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {card !== null && <HoverCard card={card} />}
    </>
  );
}

function HoverCard({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: card.x, top: card.y + 18 });
  useEffect(() => {
    // Keep the card inside the window.
    const width = ref.current?.offsetWidth ?? 0;
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(card.x - 12, window.innerWidth - width - 8));
    const below = card.y + 18;
    const top = below + height > window.innerHeight - 8 ? card.y - height - 12 : below;
    setStyle({ left, top });
  }, [card.x, card.y]);
  const { person, askedBy } = card;
  const details = ['wrote this'];
  if (person.seen > 0) {
    details.push(`last active ${ago(person.seen)}`);
  }
  if (askedBy !== null) {
    details.push(`asked by ${displayName(askedBy)}`);
  }
  return (
    <div
      ref={ref}
      {...stylex.props(surfaceStyles.card)}
      role="tooltip"
      style={{ ...peerStyle(person.color), ...style }}
      data-testid="blame-card"
    >
      <b {...stylex.props(surfaceStyles.cardName)}>{displayName(person)}</b>
      <span {...stylex.props(surfaceStyles.cardDetails)}>{details.join(' · ')}</span>
    </div>
  );
}

/** The person whose attributed text is under the point, if any. */
function attributedAt(plan: PaintPlan, x: number, y: number): string | null {
  const position = caretAt(x, y);
  if (position === null) {
    return null;
  }
  const { node, offset } = position;
  if (node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  // The caret lands between characters: check the one on each side.
  for (const index of [offset, offset - 1]) {
    if (index < 0 || index >= (node as Text).length) {
      continue;
    }
    const span = spanAt(plan.spans, node, index);
    if (span !== null && charContains(node as Text, index, x, y)) {
      return span.personId;
    }
  }
  return null;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    return position === null ? null : { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function charContains(node: Text, index: number, x: number, y: number): boolean {
  const range = new Range();
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  for (const rect of range.getClientRects()) {
    if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 2 && y <= rect.bottom + 2) {
      return true;
    }
  }
  return false;
}
