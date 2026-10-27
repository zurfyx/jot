import * as stylex from '@stylexjs/stylex';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';

import { colors } from '../theme/tokens.stylex';
import { By, Caret, Check, SparkleIcon, type Who, who } from './bits';
import { tabMarker } from './markers.stylex';
import { useReducedMotion } from './motion';
import { section } from './section.styles';

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

const NARROW = '@media (max-width: 760px)';

const fillDown = stylex.keyframes({
  from: { transform: 'scaleY(0)' },
  to: { transform: 'scaleY(1)' },
});

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 0.8fr) minmax(0, 1.4fr)',
      [NARROW]: '1fr',
    },
    gap: {
      default: 44,
      [NARROW]: 20,
    },
    alignItems: 'start',
  },
  tabs: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  tab: {
    position: 'relative',
    display: 'block',
    width: '100%',
    paddingTop: 14,
    paddingRight: 0,
    paddingBottom: 14,
    paddingLeft: 20,
    borderRadius: 0,
    textAlign: 'left',
    '::before': {
      content: "''",
      position: 'absolute',
      top: 14,
      bottom: 14,
      left: 0,
      width: 3,
      borderRadius: 2,
      backgroundColor: colors['--rule'],
    },
  },
  progress: {
    position: 'absolute',
    top: 14,
    bottom: 14,
    left: 0,
    width: 3,
    borderRadius: 2,
    backgroundColor: 'var(--who)',
    transform: 'scaleY(0)',
    transformOrigin: 'top',
  },
  progressSelected: {
    transform: 'none',
  },
  /* The chosen tab's line fills while the tabs advance on their own. */
  progressFilling: {
    animationName: fillDown,
    animationDuration: '3s',
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  tabTitle: {
    display: 'block',
    color: {
      default: colors['--muted'],
      [stylex.when.ancestor(':hover', tabMarker)]: colors['--ink'],
    },
    fontSize: 19,
    fontWeight: 650,
    lineHeight: 1.35,
  },
  tabTitleSelected: {
    color: colors['--ink'],
  },
  tabText: {
    display: 'none',
    marginTop: 6,
    color: colors['--muted'],
    fontSize: '14.5px',
    lineHeight: 1.5,
  },
  tabTextSelected: {
    display: 'block',
  },
  /* The stage sits on a grey band that runs to the window's right edge. */
  stage: {
    position: 'relative',
    isolation: 'isolate',
    minHeight: 420,
    paddingTop: {
      default: 56,
      [NARROW]: 52,
    },
    paddingInline: {
      default: 34,
      [NARROW]: 0,
    },
    paddingBottom: {
      default: 34,
      [NARROW]: 26,
    },
    '::before': {
      content: "''",
      position: 'absolute',
      top: 0,
      right: '-100vw',
      bottom: 0,
      left: {
        default: 0,
        [NARROW]: '-100vw',
      },
      zIndex: -1,
      backgroundColor: colors['--hover'],
    },
  },
  pill: {
    position: 'absolute',
    top: 18,
    right: {
      default: 22,
      [NARROW]: 0,
    },
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: colors['--muted'],
    fontSize: '12.5px',
    fontWeight: 600,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: 'var(--who, var(--muted))',
  },
  note: {
    maxWidth: 560,
  },
  noteTitle: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 10,
    fontSize: {
      default: 30,
      [NARROW]: 24,
    },
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  noteText: {
    margin: 0,
    fontSize: {
      default: 17,
      [NARROW]: '15.5px',
    },
    lineHeight: 1.7,
  },
  noteList: {
    marginTop: 4,
    marginInline: 0,
    marginBottom: 10,
    paddingLeft: 24,
  },
  noteSub: {
    marginTop: 16,
    marginInline: 0,
    marginBottom: 4,
    color: colors['--muted'],
    fontSize: 12,
    fontWeight: 650,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  muted: {
    color: colors['--muted'],
  },
  waiting: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: colors['--muted'],
    textUnderlineOffset: 4,
  },
  aside: {
    marginTop: -4,
    color: colors['--muted'],
    fontSize: 13,
  },
  asideIcon: {
    width: 11,
    height: 11,
    color: colors['--ai'],
  },
  /* The stage's blame rows: name, bar, text. */
  blameRow: {
    display: 'grid',
    gridTemplateColumns: {
      default: '56px 4px minmax(0, 1fr)',
      [NARROW]: '44px 3px minmax(0, 1fr)',
    },
    rowGap: 0,
    columnGap: {
      default: 12,
      [NARROW]: 10,
    },
    alignItems: 'stretch',
    marginBlock: 2,
    marginInline: 0,
  },
  blameName: {
    paddingTop: 6,
    color: 'var(--who)',
    fontSize: '11.5px',
    fontWeight: 650,
    textAlign: 'right',
  },
  blameBar: {
    display: 'block',
    borderRadius: 2,
    backgroundColor: 'var(--who)',
  },
});

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
    <section {...stylex.props(section.section)} aria-labelledby="engine-title">
      <p {...stylex.props(section.eyebrow)}>The engine, made visible</p>
      <h2 id="engine-title" {...stylex.props(section.title)}>
        Lexical with Yjs 14, up close.
      </h2>
      <p {...stylex.props(section.sub)}>
        jot is a playground for Lexical's new collaboration engine. Every feature is there to make
        the engine visible.
      </p>

      <div {...stylex.props(styles.grid)}>
        <div
          {...stylex.props(styles.tabs)}
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
                {...stylex.props(styles.tab, who[item.who], tabMarker)}
                onClick={() => choose(index)}
              >
                <span
                  {...stylex.props(
                    styles.progress,
                    selected && styles.progressSelected,
                    selected && advancing && styles.progressFilling,
                  )}
                  aria-hidden="true"
                  style={{ animationDuration: `${ADVANCE_MS}ms` }}
                  onAnimationEnd={() => {
                    if (selected && advancing) {
                      setActive((index + 1) % FEATURES.length);
                    }
                  }}
                />
                <span {...stylex.props(styles.tabTitle, selected && styles.tabTitleSelected)}>
                  {item.title}
                </span>
                <span {...stylex.props(styles.tabText, selected && styles.tabTextSelected)}>
                  {item.text}
                </span>
              </button>
            );
          })}
        </div>

        <div
          {...stylex.props(styles.stage)}
          id="engine-stage"
          role="tabpanel"
          aria-labelledby={`engine-tab-${feature.id}`}
        >
          <span {...stylex.props(styles.pill)} data-testid="engine-state">
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
          <i {...stylex.props(styles.pillDot, who.you)} />3 here
        </>
      );
    case 'blame':
      return (
        <>
          <i {...stylex.props(styles.pillDot, who.ai)} />
          Blame · You 46% · Ana 31% · jot AI 23%
        </>
      );
    case 'offline':
      return (
        <>
          <i {...stylex.props(styles.pillDot)} />
          Offline · 2 edits waiting
        </>
      );
    case 'ai':
      return (
        <>
          <i {...stylex.props(styles.pillDot, who.ai)} />
          jot AI is editing
        </>
      );
  }
}

const NAMES: Record<Who, string> = { you: 'You', ana: 'Ana', ai: 'jot AI' };

/** The stage's note, drawn for one feature. Static HTML, not an editor. */
function BigNote({ feature }: { feature: Feature }) {
  const blame = feature === 'blame';
  const u = (person: Who, text: string) => (blame ? <By who={person}>{text}</By> : text);
  const row = (person: Who, content: ReactNode) =>
    blame ? (
      <div {...stylex.props(styles.blameRow)} data-testid="stage-blame-row">
        <span {...stylex.props(styles.blameName, who[person])} data-testid="stage-blame-name">
          {NAMES[person]}
        </span>
        <i {...stylex.props(styles.blameBar, who[person])} data-testid="stage-blame-bar" />
        <div>{content}</div>
      </div>
    ) : (
      content
    );
  const cursors = feature === 'cursors';

  const agenda =
    feature === 'ai' ? (
      <>
        <ul {...stylex.props(styles.noteList)}>
          <li {...stylex.props(styles.noteText)}>
            <By who="ai">Morning: roadmap review</By> with demos
            <Caret />
          </li>
          <li {...stylex.props(styles.noteText)}>
            <By who="ai">Afternoon: hack session</By>
            <Caret who="ai" name="jot AI" />
          </li>
        </ul>
        <p {...stylex.props(styles.noteText, styles.aside)}>
          <SparkleIcon xstyle={styles.asideIcon} /> jot AI turned this into a list · asked by Gerard
          · on your device
        </p>
      </>
    ) : (
      <ul {...stylex.props(styles.noteList)}>
        <li {...stylex.props(styles.noteText)}>
          {u('ai', 'Morning: roadmap review')}
          {u('you', ' with demos')}
          {cursors && <Caret />}
        </li>
        <li {...stylex.props(styles.noteText)}>
          {u('ai', 'Afternoon: hack session')}
          {cursors && <Caret who="ai" name="jot AI" />}
        </li>
      </ul>
    );

  const anaCaret = cursors || feature === 'offline' ? <Caret who="ana" name="Ana" /> : null;
  const todo = (
    <>
      <p {...stylex.props(styles.noteText)}>
        <Check done />
        {u('you', 'Book the room')}
      </p>
      {feature === 'offline' && (
        <>
          <p {...stylex.props(styles.noteText, styles.waiting)}>
            <Check />
            Order lunch
          </p>
          <p {...stylex.props(styles.noteText, styles.waiting)}>
            <Check />
            Bring the projector
          </p>
        </>
      )}
      <p {...stylex.props(styles.noteText)}>
        <By who="ana">
          <Check />
          Send the agenda
        </By>
        {anaCaret}
      </p>
    </>
  );

  return (
    <div {...stylex.props(styles.note)} data-feature={feature}>
      <h3 {...stylex.props(styles.noteTitle)}>{u('you', 'Team offsite, May 14')}</h3>
      {row(
        'you',
        <p {...stylex.props(styles.noteText, styles.muted)}>
          {u('you', 'Plan for the day. Everyone can edit.')}
        </p>,
      )}
      <div {...stylex.props(styles.noteSub)}>Agenda</div>
      {row('ai', agenda)}
      <div {...stylex.props(styles.noteSub)}>To do</div>
      {row('ana', todo)}
    </div>
  );
}
