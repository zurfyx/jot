import { type MouseEvent, type RefObject, useEffect, useState } from 'react';

import { prefetchNotePage } from '../loadNote';
import { Avatars, By, Caret, Check, OpenIcon } from './bits';
import { useReducedMotion } from './motion';
import { EXAMPLE_PATH, NEW_NOTE_PATH } from './open';

const TYPED = ' with demos';
/** Ticks per loop: type the words, Ana adds her line, then a pause. */
const LOOP = TYPED.length + 14;
const ANA_AT = TYPED.length + 3;
const TICK_MS = 170;

/** The example card's loop position; the final state under reduced motion. */
function useTypingTick(reduced: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) {
      return;
    }
    const timer = window.setInterval(() => setTick((t) => (t + 1) % (LOOP + 1)), TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduced]);
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
  const tick = useTypingTick(useReducedMotion());
  const typed = TYPED.slice(0, Math.min(tick, TYPED.length));
  const anaHere = tick >= ANA_AT;

  const open = (action: () => void) => (event: MouseEvent) => {
    // Let modified clicks open a tab the browser's way.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    action();
  };

  return (
    <div className="fan" onPointerEnter={prefetchNotePage}>
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
          onClick={open(onExample)}
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
          onClick={open(onNew)}
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
