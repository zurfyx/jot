import { useEffect, useState } from 'react';

import { By, Caret, LinkIcon } from './bits';
import { useReducedMotion } from './motion';

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

function usePhase(reduced: boolean): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced) {
      return;
    }
    const timers: number[] = [];
    const run = () => {
      PHASE_STARTS.forEach((start, index) => {
        timers.push(window.setTimeout(() => setPhase(index), start));
      });
      timers.push(window.setTimeout(run, LOOP_MS));
    };
    run();
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduced]);
  return reduced ? FINAL_PHASE : phase;
}

const STEPS = [
  {
    who: 'you',
    title: '1 · Start a note',
    text: "It's yours, on this device, until you share it.",
  },
  {
    who: 'ana',
    title: '2 · Share the link',
    text: 'The link is the key: whoever has it can edit.',
  },
  { who: 'ai', title: '3 · Type together', text: 'Both windows edit at once, even offline.' },
] as const;

/** "Try it in two windows": two small browser windows sharing one note. */
export function TwoWindows() {
  const phase = usePhase(useReducedMotion());
  const step = stepOfPhase(phase);
  const opened = phase >= 3;
  const together = phase >= FINAL_PHASE;

  return (
    <section className="section how" aria-labelledby="how-title">
      <p className="eyebrow">Try it in two windows</p>
      <h2 id="how-title">Start a note. Share it. Type together.</h2>

      <div
        className="windows"
        data-phase={phase}
        role="img"
        aria-label="A note starts in one window, its link is shared, and a second window opens it. Both type at once."
      >
        <div className="window">
          <div className="window-bar">
            <i />
            <i />
            <i />
            <span>jot.rovira.sh</span>
          </div>
          <div className="window-body">
            <h4>
              Plan for Thursday
              {!opened && <Caret />}
            </h4>
            {opened ? (
              <>
                <p>
                  <By who="ana">Bring the projector</By>
                  <Caret who="ana" name="Ana" />
                </p>
                {together && (
                  <p>
                    <By who="you">Book the room</By>
                    <Caret />
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Only on this device.</p>
            )}
          </div>
        </div>

        <span className="link-pill">
          <LinkIcon /> jot.rovira.sh/n/k3Jd9x…
        </span>

        <div className={`window window-second${opened ? ' is-open' : ''}`}>
          <div className="window-bar">
            <i />
            <i />
            <i />
            <span>{opened ? 'jot.rovira.sh/n/k3Jd9xQ2…' : 'New tab'}</span>
          </div>
          <div className="window-body">
            {opened ? (
              <>
                <h4>Plan for Thursday</h4>
                <p>
                  <By who="ana">Bring the projector</By>
                  <Caret who="ana" name="Ana" />
                </p>
                {together && (
                  <p>
                    <By who="you">Book the room</By>
                    <Caret who="you" name="You" />
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Paste the link…</p>
            )}
          </div>
        </div>
      </div>

      <ol className="steps" data-testid="how-steps">
        {STEPS.map((item, index) => (
          <li key={item.title} className={`is-${item.who}${index <= step ? ' is-on' : ''}`}>
            <b>{item.title}</b>
            <span>{item.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
