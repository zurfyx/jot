import { type RefObject, useEffect, useRef, useState } from 'react';

import { prefetchNotePage } from '../loadNote';
import { Avatars, By, Caret, Check, OpenIcon } from './bits';
import { useOnScreen, useReducedMotion } from './motion';
import { EXAMPLE_PATH, NEW_NOTE_PATH, plainClick } from './open';

const TYPED = ' with demos';
/** Ticks per loop: type the words, Ana adds her line, then a pause. */
const LOOP = TYPED.length + 14;
const ANA_AT = TYPED.length + 3;
const TICK_MS = 170;

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

  return (
    <div
      ref={fan}
      className="fan"
      data-active={active ? 'true' : 'false'}
      onPointerEnter={prefetchNotePage}
    >
      <div className="fan-glow" aria-hidden="true">
        <b />
        <b />
        <b />
      </div>
      <div className="fan-cards">
        <div className="fan-card fan-recipe" aria-hidden="true">
          <div className="card-head">
            <span className="card-tag is-ana">Recipe</span>
            <Avatars
              people={[
                ['ana', 'A'],
                ['you', 'L'],
              ]}
            />
          </div>
          <h4>Grandma's pancakes</h4>
          <div className="card-sub">Ingredients</div>
          <ul>
            <li>
              <By who="you">2 cups flour</By>
            </li>
            <li>
              <By who="ana">1 tbsp sugar</By>
            </li>
            <li>
              <By who="ai">A pinch of salt</By>
            </li>
          </ul>
        </div>

        <a
          ref={exampleCard}
          className="fan-card fan-example"
          href={EXAMPLE_PATH}
          aria-label="Open the example"
          onClick={plainClick(onExample)}
          data-testid="example-card"
        >
          <div className="card-head">
            <span className="card-tag is-ai">Example · live</span>
            <Avatars
              people={[
                ['you', 'G'],
                ['ana', 'A'],
                ['ai', '✦'],
              ]}
            />
          </div>
          <h4>Team offsite</h4>
          <div className="card-sub">Agenda</div>
          <ul>
            <li>
              <By who="ai">Morning: roadmap review</By>
              <By who="you">{typed}</By>
              <Caret />
            </li>
            <li>
              <By who="ai">Afternoon: hack session</By>
              <Caret who="ai" name="jot AI" />
            </li>
          </ul>
          <div className="card-sub">To do</div>
          <p>
            <Check done />
            Book the room
          </p>
          {anaHere && (
            <p>
              <By who="ana">
                <Check />
                Send the agenda
              </By>
              <Caret who="ana" name="Ana" />
            </p>
          )}
          <span className="card-open" aria-hidden="true">
            Open <OpenIcon />
          </span>
        </a>

        <a
          ref={newCard}
          className="fan-card fan-new"
          href={NEW_NOTE_PATH}
          aria-label="Open a new note"
          onClick={plainClick(onNew)}
          data-testid="new-note-card"
        >
          <div className="card-head">
            <span className="card-tag">New note</span>
            <span className="card-device">this device</span>
          </div>
          <h4 className="card-untitled">
            Untitled
            <Caret />
          </h4>
          <p className="card-muted">Write anything. # for a heading, - for a list.</p>
          <div className="card-keys">
            Press <kbd>any key</kbd> to start
          </div>
          <span className="card-open" aria-hidden="true">
            Open <OpenIcon />
          </span>
        </a>
      </div>
    </div>
  );
}
