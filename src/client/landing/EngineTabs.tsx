import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';

import { By, Caret, Check, SparkleIcon, type Who } from './bits';
import { useReducedMotion } from './motion';

export const FEATURES = [
  {
    id: 'cursors',
    who: 'you',
    title: 'Live cursors',
    text: "See who's here and where they're typing.",
  },
  { id: 'blame', who: 'ai', title: 'Blame', text: "Who wrote what, in each author's colour." },
  {
    id: 'offline',
    who: 'ana',
    title: 'Offline, then merge',
    text: 'Go offline on purpose, edit apart, reconnect.',
  },
  {
    id: 'ai',
    who: 'accent',
    title: 'AI as a collaborator',
    text: 'A model on your device edits like a person.',
  },
] as const;

type Feature = (typeof FEATURES)[number]['id'];

/** How long each tab stays before the next, in ms (the progress line's duration). */
export const ADVANCE_MS = 3000;

/**
 * "The engine, made visible": four tabs over one illustrative note. The
 * active tab's progress line fills over ADVANCE_MS and its end advances to
 * the next tab, so the line and the switch can't drift apart, and under
 * reduced motion (no animation) nothing advances. Choosing a tab stops it.
 */
export function EngineTabs() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const advancing = auto && !reduced;

  const choose = (index: number, focus = false) => {
    setAuto(false);
    setActive(index);
    if (focus) {
      tabs.current[index]?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const last = FEATURES.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: active === last ? 0 : active + 1,
      ArrowRight: active === last ? 0 : active + 1,
      ArrowUp: active === 0 ? last : active - 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      choose(next, true);
    }
  };

  const feature = FEATURES[active] ?? FEATURES[0];

  return (
    <section className="section engine" aria-labelledby="engine-title">
      <p className="eyebrow">The engine, made visible</p>
      <h2 id="engine-title">Lexical with Yjs 14, up close.</h2>
      <p className="section-sub">
        jot is a playground for Lexical's new collaboration engine. Every feature is there to make
        the engine visible.
      </p>

      <div className="engine-grid">
        <div
          className="engine-tabs"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Features"
          onKeyDown={onKeyDown}
          data-auto={advancing ? 'true' : 'false'}
        >
          {FEATURES.map((item, index) => {
            const selected = index === active;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`engine-tab-${item.id}`}
                aria-selected={selected}
                aria-controls="engine-stage"
                tabIndex={selected ? 0 : -1}
                className={`engine-tab is-${item.who}`}
                onClick={() => choose(index)}
              >
                <span
                  className="engine-progress"
                  aria-hidden="true"
                  style={{ animationDuration: `${ADVANCE_MS}ms` }}
                  onAnimationEnd={() => {
                    if (selected && advancing) {
                      setActive((index + 1) % FEATURES.length);
                    }
                  }}
                />
                <span className="engine-tab-title">{item.title}</span>
                <span className="engine-tab-text">{item.text}</span>
              </button>
            );
          })}
        </div>

        <div
          className="engine-stage"
          id="engine-stage"
          role="tabpanel"
          aria-labelledby={`engine-tab-${feature.id}`}
        >
          <span className="state-pill" data-testid="engine-state">
            <StatePill feature={feature.id} />
          </span>
          <BigNote feature={feature.id} />
        </div>
      </div>
    </section>
  );
}

function StatePill({ feature }: { feature: Feature }) {
  switch (feature) {
    case 'cursors':
      return (
        <>
          <i className="is-you" />3 here
        </>
      );
    case 'blame':
      return (
        <>
          <i className="is-ai" />
          Blame · You 46% · Ana 31% · jot AI 23%
        </>
      );
    case 'offline':
      return (
        <>
          <i className="is-muted" />
          Offline · 2 edits waiting
        </>
      );
    case 'ai':
      return (
        <>
          <i className="is-ai" />
          jot AI is editing
        </>
      );
  }
}

const NAMES: Record<Who, string> = { you: 'You', ana: 'Ana', ai: 'jot AI' };

/** The stage's note, drawn for one feature. Static HTML, not an editor. */
function BigNote({ feature }: { feature: Feature }) {
  const blame = feature === 'blame';
  const u = (who: Who, text: string) => (blame ? <By who={who}>{text}</By> : text);
  const row = (who: Who, content: ReactNode) =>
    blame ? (
      <div className="stage-blame-row" data-testid="stage-blame-row">
        <span className={`stage-blame-name is-${who}`} data-testid="stage-blame-name">
          {NAMES[who]}
        </span>
        <i className={`stage-blame-bar is-${who}`} data-testid="stage-blame-bar" />
        <div className="stage-blame-text">{content}</div>
      </div>
    ) : (
      content
    );
  const cursors = feature === 'cursors';

  const agenda =
    feature === 'ai' ? (
      <>
        <ul>
          <li>
            <By who="ai">Morning: roadmap review</By> with demos
            <Caret />
          </li>
          <li>
            <By who="ai">Afternoon: hack session</By>
            <Caret who="ai" name="jot AI" />
          </li>
        </ul>
        <p className="note-aside">
          <SparkleIcon className="note-aside-icon" /> jot AI turned this into a list · asked by
          Gerard · on your device
        </p>
      </>
    ) : (
      <ul>
        <li>
          {u('ai', 'Morning: roadmap review')}
          {u('you', ' with demos')}
          {cursors && <Caret />}
        </li>
        <li>
          {u('ai', 'Afternoon: hack session')}
          {cursors && <Caret who="ai" name="jot AI" />}
        </li>
      </ul>
    );

  const anaCaret = cursors || feature === 'offline' ? <Caret who="ana" name="Ana" /> : null;
  const todo = (
    <>
      <p>
        <Check done />
        {u('you', 'Book the room')}
      </p>
      {feature === 'offline' && (
        <>
          <p className="is-waiting">
            <Check />
            Order lunch
          </p>
          <p className="is-waiting">
            <Check />
            Bring the projector
          </p>
        </>
      )}
      <p>
        <By who="ana">
          <Check />
          Send the agenda
        </By>
        {anaCaret}
      </p>
    </>
  );

  return (
    <div className="big-note" data-feature={feature}>
      <h3>{u('you', 'Team offsite, May 14')}</h3>
      {row('you', <p className="muted">{u('you', 'Plan for the day. Everyone can edit.')}</p>)}
      <div className="note-sub">Agenda</div>
      {row('ai', agenda)}
      <div className="note-sub">To do</div>
      {row('ana', todo)}
    </div>
  );
}
