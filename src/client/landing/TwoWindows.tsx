import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { colors, landing, motion } from '../theme/tokens.stylex';
import { By, Caret, LinkIcon, type Who, who } from './bits';
import { useOnScreen, useReducedMotion } from './motion';
import { section } from './section.styles';

/**
 * The story, as phases: 0 a note starts in window one; 1 its link appears;
 * 2 the link slides across; 3 window two opens the note; 4 both type.
 * Each entry is when the phase starts, in ms; the loop restarts at the end.
 */
export const PHASE_STARTS = [0, 1400, 2400, 3200, 4300] as const;
export const LOOP_MS = 7600;
const FINAL_PHASE = PHASE_STARTS.length - 1;

/** Which of the three steps a phase belongs to (0-based). */
export function stepOfPhase(phase: number): number {
  return phase === 0 ? 0 : phase < FINAL_PHASE ? 1 : 2;
}

/** The story's phase: it restarts when it comes back on screen, and rests on the end under reduced motion. */
function usePhase(reduced: boolean, running: boolean): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced || !running) {
      return;
    }
    // One timer at a time: each phase schedules the next, the last the loop.
    let timer = 0;
    const enter = (index: number) => {
      setPhase(index);
      const next = PHASE_STARTS[index + 1];
      const here = PHASE_STARTS[index] ?? 0;
      timer = window.setTimeout(
        () => enter(next === undefined ? 0 : index + 1),
        (next ?? LOOP_MS) - here,
      );
    };
    enter(0);
    return () => window.clearTimeout(timer);
  }, [reduced, running]);
  return reduced ? FINAL_PHASE : phase;
}

const STEPS = [
  {
    who: 'you',
    title: '1 · Start a note',
    text: 'It has its own link from the first keystroke.',
  },
  {
    who: 'ana',
    title: '2 · Share the link',
    text: 'The link is the key: whoever has it can edit.',
  },
  { who: 'ai', title: '3 · Type together', text: 'Both windows edit at once, even offline.' },
] as const;

const NARROW = '@media (max-width: 760px)';

const styles = stylex.create({
  how: {
    paddingTop: 56,
  },
  title: {
    marginBottom: 26,
  },
  windows: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: {
      default: '1fr 1fr',
      [NARROW]: '1fr',
    },
    gap: {
      default: 70,
      [NARROW]: 10,
    },
    alignItems: 'start',
  },
  window: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: landing['--card'],
    boxShadow: `0 0 0 1px ${landing['--card-rule']}, 0 1px 2px ${landing['--card-shadow-near']}, 0 18px 40px -18px ${landing['--card-shadow-mid']}`,
  },
  second: {
    opacity: 0.35,
    transitionProperty: 'opacity',
    transitionDuration: '0.4s',
    transitionTimingFunction: 'ease-out',
  },
  secondOpen: {
    opacity: 1,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 9,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--rule'],
    color: colors['--muted'],
    fontSize: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: colors['--rule'],
  },
  address: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    marginLeft: 8,
    paddingBlock: 3,
    paddingInline: 8,
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: colors['--hover'],
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    minHeight: 150,
    paddingBlock: 16,
    paddingInline: 18,
  },
  heading: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 6,
    fontSize: 18,
    fontWeight: 650,
  },
  text: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.75,
  },
  muted: {
    color: colors['--muted'],
  },
  /* The link slides from the first window to the second (data-phase). */
  pill: {
    position: {
      default: 'absolute',
      [NARROW]: 'relative',
    },
    top: {
      default: 44,
      [NARROW]: 'auto',
    },
    left: {
      default: '50%',
      [NARROW]: 'auto',
    },
    justifySelf: {
      default: null,
      [NARROW]: 'center',
    },
    zIndex: 3,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingBlock: 0,
    paddingInline: 12,
    borderRadius: 999,
    backgroundColor: colors['--btn'],
    color: colors['--btn-ink'],
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    opacity: 0,
    transform: {
      default: 'translateX(-120%)',
      [NARROW]: 'translateY(-8px)',
    },
    transitionProperty: 'transform, opacity',
    transitionDuration: '0.8s, 0.3s',
    transitionTimingFunction: 'cubic-bezier(0.3, 0.7, 0.2, 1), ease-out',
  },
  pillShown: {
    opacity: 1,
    transform: {
      default: 'translateX(-50%)',
      [NARROW]: 'none',
    },
  },
  pillAcross: {
    opacity: 1,
    transform: {
      default: 'translateX(20%)',
      [NARROW]: 'translateY(8px)',
    },
  },
  pillDone: {
    transform: {
      default: 'translateX(20%)',
      [NARROW]: 'translateY(8px)',
    },
  },
  pillIcon: {
    width: 12,
    height: 12,
  },
  steps: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(3, 1fr)',
      [NARROW]: '1fr',
    },
    gap: {
      default: 20,
      [NARROW]: 14,
    },
    marginTop: 26,
    marginInline: 0,
    marginBottom: 0,
    padding: 0,
    listStyle: 'none',
  },
  step: {
    position: 'relative',
    paddingTop: 18,
    opacity: 0.55,
    transitionProperty: 'opacity',
    transitionDuration: '0.4s',
    transitionTimingFunction: 'ease-out',
    '::before': {
      content: "''",
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors['--rule'],
    },
    '::after': {
      content: "''",
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: 3,
      borderRadius: 2,
      backgroundColor: 'var(--who)',
      transform: 'scaleX(0)',
      transformOrigin: 'left',
      transitionProperty: 'transform',
      transitionDuration: '0.5s',
      transitionTimingFunction: motion['--ease'],
    },
  },
  stepOn: {
    opacity: 1,
    '::after': {
      transform: 'none',
    },
  },
  stepTitle: {
    display: 'block',
    marginBottom: 3,
    fontSize: 16,
    fontWeight: 700,
  },
  stepText: {
    color: colors['--muted'],
    fontSize: 14,
    lineHeight: 1.5,
  },
});

/** Where the link is in each phase: hidden, shown, across, then resting there hidden. */
const PILL = [null, styles.pillShown, styles.pillAcross, styles.pillDone, styles.pillDone];

/** "Try it in two windows": two small browser windows sharing one note. */
export function TwoWindows() {
  const element = useRef<HTMLElement>(null);
  const phase = usePhase(useReducedMotion(), useOnScreen(element));
  const step = stepOfPhase(phase);
  const opened = phase >= 3;
  const together = phase >= FINAL_PHASE;

  return (
    <section
      ref={element}
      {...stylex.props(section.section, styles.how)}
      aria-labelledby="how-title"
    >
      <p {...stylex.props(section.eyebrow)}>Try it in two windows</p>
      <h2 id="how-title" {...stylex.props(section.title, styles.title)}>
        Start a note. Share it. Type together.
      </h2>

      <div
        {...stylex.props(styles.windows)}
        data-phase={phase}
        role="img"
        aria-label="A note starts in one window, its link is shared, and a second window opens it. Both type at once."
      >
        <div {...stylex.props(styles.window)}>
          <div {...stylex.props(styles.bar)}>
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <span {...stylex.props(styles.address)}>jot.rovira.sh/n/k3Jd9xQ2…</span>
          </div>
          <div {...stylex.props(styles.body)}>
            <h4 {...stylex.props(styles.heading)}>
              Plan for Thursday
              {!opened && <Caret />}
            </h4>
            {opened ? (
              <>
                <p {...stylex.props(styles.text)}>
                  <By who="ana">Bring the projector</By>
                  <Caret who="ana" name="Ana" />
                </p>
                {together && (
                  <p {...stylex.props(styles.text)}>
                    <By who="you">Book the room</By>
                    <Caret />
                  </p>
                )}
              </>
            ) : (
              <p {...stylex.props(styles.text, styles.muted)}>Anyone with the link can edit.</p>
            )}
          </div>
        </div>

        <span {...stylex.props(styles.pill, PILL[phase])}>
          <LinkIcon xstyle={styles.pillIcon} /> jot.rovira.sh/n/k3Jd9x…
        </span>

        <div {...stylex.props(styles.window, styles.second, opened && styles.secondOpen)}>
          <div {...stylex.props(styles.bar)}>
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <i {...stylex.props(styles.dot)} />
            <span {...stylex.props(styles.address)}>
              {opened ? 'jot.rovira.sh/n/k3Jd9xQ2…' : 'New tab'}
            </span>
          </div>
          <div {...stylex.props(styles.body)}>
            {opened ? (
              <>
                <h4 {...stylex.props(styles.heading)}>Plan for Thursday</h4>
                <p {...stylex.props(styles.text)}>
                  <By who="ana">Bring the projector</By>
                  <Caret who="ana" name="Ana" />
                </p>
                {together && (
                  <p {...stylex.props(styles.text)}>
                    <By who="you">Book the room</By>
                    <Caret who="you" name="You" />
                  </p>
                )}
              </>
            ) : (
              <p {...stylex.props(styles.text, styles.muted)}>Paste the link…</p>
            )}
          </div>
        </div>
      </div>

      <ol {...stylex.props(styles.steps)} data-testid="how-steps">
        {STEPS.map((item, index) => (
          <Step key={item.title} who={item.who} on={index <= step}>
            <b {...stylex.props(styles.stepTitle)}>{item.title}</b>
            <span {...stylex.props(styles.stepText)}>{item.text}</span>
          </Step>
        ))}
      </ol>
    </section>
  );
}

/** A step, its bar filled in its colour once the story reaches it. */
function Step({ who: person, on, children }: { who: Who; on: boolean; children: ReactNode }) {
  const { className = '', ...props } = stylex.props(styles.step, who[person], on && styles.stepOn);
  // `is-on` stays as a plain marker class: the specs find the filled steps by it.
  return (
    <li className={on ? `${className} is-on` : className} {...props}>
      {children}
    </li>
  );
}
