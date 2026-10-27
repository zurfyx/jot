import * as stylex from '@stylexjs/stylex';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { prefetchNotePage } from '../loadNote';
import { colors, fonts, landing } from '../theme/tokens.stylex';
import { Avatars, By, Caret, Check, OpenIcon, who } from './bits';
import { cardMarker, exampleMarker, fanMarker } from './markers.stylex';
import { useOnScreen, useReducedMotion } from './motion';
import { NEW_NOTE_PATH } from '../notes';
import { EXAMPLE_PATH, plainClick } from './open';

const TYPED = ' with demos';
/** Ticks per loop: type the words, Ana adds her line, then a pause. */
const LOOP = TYPED.length + 14;
const ANA_AT = TYPED.length + 3;
const TICK_MS = 170;

const NARROW = '@media (max-width: 760px)';

const blink = stylex.keyframes({ '50%': { opacity: 0 } });
const drift = stylex.keyframes({
  '0%': { transform: 'translate(0, 0) scale(1)' },
  '50%': { transform: 'translate(-8%, 6%) scale(1.15)' },
  '100%': { transform: 'translate(6%, -5%) scale(0.95)' },
});
const swayLeft = stylex.keyframes({ to: { rotate: '-1.5deg' } });
const swayRight = stylex.keyframes({ to: { rotate: '1.5deg' } });

/*
 * Relational conditions (stylex.when.*) are written in place: the compiler
 * resolves them there, and a constant would be left to run in the browser.
 * The fan's cards (fanMarker) spread when hovered or focused inside; the
 * example card (exampleMarker) tilts the New note card in front; a card you
 * can open (cardMarker) shows its Open button.
 */

const SHADOW_REST = `0 1px 0 ${landing['--card-highlight']} inset, 0 1px 2px ${landing['--card-shadow-near']}, 0 12px 28px -10px ${landing['--card-shadow-mid']}, 0 40px 80px -30px ${landing['--card-shadow-far']}`;
const SHADOW_LIFT = `0 1px 0 ${landing['--card-highlight']} inset, 0 50px 90px -30px ${landing['--card-shadow-lift']}`;
const NEW_TILTED = 'rotate(-3deg) translateX(2%)';
const LIFTED = 'translateY(-22px)';

const styles = stylex.create({
  fan: {
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    top: '6%',
    right: '-6%',
    zIndex: 0,
    width: '62%',
    height: '90%',
    opacity: landing['--glow-opacity'],
    filter: 'blur(60px)',
    pointerEvents: 'none',
  },
  blob: {
    position: 'absolute',
    width: '55%',
    height: '55%',
    borderRadius: '50%',
    animationName: drift,
    animationDuration: '20s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
  },
  blobYou: {
    top: '30%',
    left: '4%',
    backgroundColor: landing['--you'],
  },
  blobAi: {
    top: '4%',
    left: '34%',
    backgroundColor: colors['--ai'],
    animationDelay: '-7s',
  },
  blobAna: {
    top: '44%',
    left: '44%',
    backgroundColor: landing['--ana'],
    animationDelay: '-13s',
  },
  /* Off screen or in a hidden tab, the hero's loops hold still. */
  paused: {
    animationPlayState: 'paused',
  },
  cards: {
    '--card-w': {
      default: 'min(320px, 74%)',
      [NARROW]: 'min(270px, 68%)',
    },
    position: 'relative',
    zIndex: 1,
    height: {
      default: 440,
      [NARROW]: 390,
    },
  },
  card: {
    position: 'absolute',
    top: 34,
    left: '54%',
    display: 'block',
    width: 'var(--card-w)',
    height: 340,
    marginLeft: 'calc(var(--card-w) / -2)',
    paddingBlock: 18,
    paddingInline: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: landing['--card-rule'],
    borderRadius: 20,
    backgroundColor: landing['--card'],
    color: colors['--ink'],
    boxShadow: SHADOW_REST,
    transformOrigin: '50% 135%',
    transitionProperty: 'transform',
    transitionDuration: '0.8s',
    transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
  },
  /* The two cards that open a note are links. */
  link: {
    color: 'inherit',
    textDecorationLine: 'none',
    cursor: 'pointer',
    outlineOffset: {
      default: null,
      ':focus-visible': 4,
    },
  },
  recipe: {
    transform: {
      default: 'rotate(-10deg) translateX(4%)',
      [stylex.when.ancestor(':hover', fanMarker)]: 'rotate(-14deg) translateX(2%)',
      [stylex.when.ancestor(':focus-within', fanMarker)]: 'rotate(-14deg) translateX(2%)',
    },
    animationName: swayLeft,
    animationDuration: '7s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
  },
  example: {
    zIndex: {
      default: null,
      ':hover': 4,
      ':focus-visible': 4,
    },
    transform: {
      default: 'rotate(10deg) translateX(4%)',
      [stylex.when.ancestor(':hover', fanMarker)]: 'rotate(15deg) translateX(10%)',
      [stylex.when.ancestor(':focus-within', fanMarker)]: 'rotate(15deg) translateX(10%)',
      ':hover': 'rotate(12deg) translateX(10%) translateY(-22px)',
      ':focus-visible': 'rotate(12deg) translateX(10%) translateY(-22px)',
    },
    boxShadow: {
      default: SHADOW_REST,
      ':hover': SHADOW_LIFT,
      ':focus-visible': SHADOW_LIFT,
    },
    animationName: swayRight,
    animationDuration: '7s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
  },
  /*
   * The New note card lifts when hovered, but tilts aside whenever the
   * example card is hovered or focused, even while it is hovered itself.
   */
  new: {
    zIndex: 3,
    transform: {
      default: null,
      [stylex.when.ancestor(':hover', fanMarker)]: 'translateY(-6px)',
      [stylex.when.ancestor(':focus-within', fanMarker)]: 'translateY(-6px)',
      [stylex.when.siblingBefore(':hover', exampleMarker)]: NEW_TILTED,
      [stylex.when.siblingBefore(':focus-visible', exampleMarker)]: NEW_TILTED,
      ':hover': {
        default: LIFTED,
        [stylex.when.siblingBefore(':hover', exampleMarker)]: NEW_TILTED,
        [stylex.when.siblingBefore(':focus-visible', exampleMarker)]: NEW_TILTED,
      },
      ':focus-visible': {
        default: LIFTED,
        [stylex.when.siblingBefore(':hover', exampleMarker)]: NEW_TILTED,
        [stylex.when.siblingBefore(':focus-visible', exampleMarker)]: NEW_TILTED,
      },
    },
    boxShadow: {
      default: SHADOW_REST,
      ':hover': SHADOW_LIFT,
      ':focus-visible': SHADOW_LIFT,
    },
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    color: colors['--muted'],
    fontSize: 12,
    fontWeight: 600,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingBlock: 0,
    paddingInline: 9,
    borderRadius: 999,
    backgroundColor: colors['--hover'],
    color: colors['--ink'],
    whiteSpace: 'nowrap',
    '::before': {
      content: "''",
      width: 7,
      height: 7,
      borderRadius: '50%',
      backgroundColor: 'var(--who, var(--ink))',
    },
  },
  tagLink: {
    marginLeft: 'auto',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  title: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 8,
    fontSize: 21,
    fontWeight: 750,
    letterSpacing: '-0.015em',
    lineHeight: 1.3,
  },
  muted: {
    color: colors['--muted'],
  },
  text: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
  },
  list: {
    marginTop: 4,
    marginInline: 0,
    marginBottom: 8,
    paddingLeft: 20,
  },
  sub: {
    marginTop: 12,
    marginInline: 0,
    marginBottom: 4,
    color: colors['--muted'],
    fontSize: '11.5px',
    fontWeight: 650,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  blink: {
    animationName: blink,
    animationDuration: '1.1s',
    animationTimingFunction: 'steps(1)',
    animationIterationCount: 'infinite',
  },
  keys: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    left: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: colors['--muted'],
    fontSize: '12.5px',
  },
  key: {
    paddingBlock: 2,
    paddingInline: 6,
    borderWidth: 1,
    borderBottomWidth: 2,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 6,
    backgroundColor: landing['--card'],
    color: colors['--ink'],
    fontFamily: fonts['--sans'],
    fontSize: 11,
    fontWeight: 600,
  },
  open: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingBlock: 0,
    paddingInline: 12,
    borderRadius: 10,
    backgroundColor: colors['--btn'],
    color: colors['--btn-ink'],
    fontSize: 13,
    fontWeight: 650,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', cardMarker)]: 1,
      [stylex.when.ancestor(':focus-visible', cardMarker)]: 1,
    },
    transform: {
      default: 'translateY(6px)',
      [stylex.when.ancestor(':hover', cardMarker)]: 'none',
      [stylex.when.ancestor(':focus-visible', cardMarker)]: 'none',
    },
    transitionProperty: 'opacity, transform',
    transitionDuration: '0.25s',
    transitionTimingFunction: 'ease-out',
  },
  openIcon: {
    width: 12,
    height: 12,
  },
});

/**
 * The example card's loop position: it holds while `running` is false, and
 * shows the final state under reduced motion.
 */
function useTypingTick(reduced: boolean, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced || !running) {
      return;
    }
    const timer = window.setInterval(() => setTick((t) => (t + 1) % (LOOP + 1)), TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduced, running]);
  return reduced ? ANA_AT : tick;
}

type FanProps = {
  newCard: RefObject<HTMLAnchorElement | null>;
  exampleCard: RefObject<HTMLAnchorElement | null>;
  onNew: () => void;
  onExample: () => void;
};

/** The hero's three fanned notes: a recipe, the live example and a new note in front. */
export function Fan({ newCard, exampleCard, onNew, onExample }: FanProps) {
  const fan = useRef<HTMLDivElement>(null);
  const active = useOnScreen(fan);
  const tick = useTypingTick(useReducedMotion(), active);
  const typed = TYPED.slice(0, Math.min(tick, TYPED.length));
  const anaHere = tick >= ANA_AT;
  // Off screen or in a hidden tab, the hero's loops hold still.
  const paused = !active && styles.paused;

  return (
    <div
      ref={fan}
      {...stylex.props(styles.fan)}
      data-active={active ? 'true' : 'false'}
      onPointerEnter={prefetchNotePage}
    >
      <div {...stylex.props(styles.glow)} aria-hidden="true">
        <b {...stylex.props(styles.blob, styles.blobYou, paused)} />
        <b {...stylex.props(styles.blob, styles.blobAi, paused)} />
        <b {...stylex.props(styles.blob, styles.blobAna, paused)} />
      </div>
      <div {...stylex.props(styles.cards, fanMarker)}>
        <div {...stylex.props(styles.card, styles.recipe, paused)} aria-hidden="true">
          <div {...stylex.props(styles.head)}>
            <span {...stylex.props(styles.tag, who.ana)}>Recipe</span>
            <Avatars
              people={[
                ['ana', 'A'],
                ['you', 'L'],
              ]}
            />
          </div>
          <h4 {...stylex.props(styles.title)}>Grandma's pancakes</h4>
          <div {...stylex.props(styles.sub)}>Ingredients</div>
          <ul {...stylex.props(styles.list)}>
            <li {...stylex.props(styles.text)}>
              <By who="you">2 cups flour</By>
            </li>
            <li {...stylex.props(styles.text)}>
              <By who="ana">1 tbsp sugar</By>
            </li>
            <li {...stylex.props(styles.text)}>
              <By who="ai">A pinch of salt</By>
            </li>
          </ul>
        </div>

        <a
          ref={exampleCard}
          {...stylex.props(
            styles.card,
            styles.link,
            styles.example,
            paused,
            cardMarker,
            exampleMarker,
          )}
          href={EXAMPLE_PATH}
          aria-label="Open the example"
          onClick={plainClick(onExample)}
          data-testid="example-card"
        >
          <div {...stylex.props(styles.head)}>
            <span {...stylex.props(styles.tag, who.ai)}>Example · live</span>
            <Avatars
              people={[
                ['you', 'G'],
                ['ana', 'A'],
                ['ai', '✦'],
              ]}
            />
          </div>
          <h4 {...stylex.props(styles.title)}>Team offsite</h4>
          <div {...stylex.props(styles.sub)}>Agenda</div>
          <ul {...stylex.props(styles.list)}>
            <li {...stylex.props(styles.text)}>
              <By who="ai">Morning: roadmap review</By>
              <By who="you">{typed}</By>
              <Caret />
            </li>
            <li {...stylex.props(styles.text)}>
              <By who="ai">Afternoon: hack session</By>
              <Caret who="ai" name="jot AI" />
            </li>
          </ul>
          <div {...stylex.props(styles.sub)}>To do</div>
          <p {...stylex.props(styles.text)}>
            <Check done />
            Book the room
          </p>
          {anaHere && (
            <p {...stylex.props(styles.text)}>
              <By who="ana">
                <Check />
                Send the agenda
              </By>
              <Caret who="ana" name="Ana" />
            </p>
          )}
          <span {...stylex.props(styles.open)} aria-hidden="true">
            Open <OpenIcon xstyle={styles.openIcon} />
          </span>
        </a>

        <a
          ref={newCard}
          {...stylex.props(styles.card, styles.link, styles.new, cardMarker)}
          href={NEW_NOTE_PATH}
          aria-label="Open a new note"
          onClick={plainClick(onNew)}
          data-testid="new-note-card"
        >
          <div {...stylex.props(styles.head)}>
            <span {...stylex.props(styles.tag)}>New note</span>
            <span {...stylex.props(styles.tagLink)}>its own link</span>
          </div>
          <h4 {...stylex.props(styles.title, styles.muted)}>
            Untitled
            <Caret xstyle={[styles.blink, paused]} />
          </h4>
          <p {...stylex.props(styles.text, styles.muted)}>
            Write anything. # for a heading, - for a list.
          </p>
          <div {...stylex.props(styles.keys)}>
            Press <kbd {...stylex.props(styles.key)}>any key</kbd> to start
          </div>
          <span {...stylex.props(styles.open)} aria-hidden="true">
            Open <OpenIcon xstyle={styles.openIcon} />
          </span>
        </a>
      </div>
    </div>
  );
}
