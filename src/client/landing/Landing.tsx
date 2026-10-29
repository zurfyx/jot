import * as stylex from '@stylexjs/stylex';
import { type ComponentProps, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

import { prefetchNotePage } from '../loadNote';
import { SparkleIcon } from './bits';
import { EngineTabs } from './EngineTabs';
import { Fan } from './Fan';
import { JoinField } from './JoinField';
import { classifyTarget, landingKeyAction, startShortcutLabel } from './keys';
import { NEW_NOTE_PATH, newNotePath } from '../notes';
import { EXAMPLE_PATH, openNote, plainClick } from './open';
import { section } from './section.styles';
import { useThemeName } from '../theme';
import { landingCardsDark, landingDark, landingLight } from '../theme/themes';
import { colors, fonts, landing, motion } from '../theme/tokens.stylex';
import { TwoWindows } from './TwoWindows';

const GITHUB_URL = 'https://github.com/zurfyx/jot';
const LEXICAL_URL = 'https://lexical.dev';
const YJS_URL = 'https://github.com/yjs/yjs';

/** The docs pages the landing page points at (PR "docs" serves them). */
export const DOCS = {
  home: '/docs',
  quickStart: '/docs/quick-start',
  contentInYjs: '/docs/content-in-yjs',
  relay: '/docs/relay',
  blame: '/docs/blame',
} as const;

const NARROW = '@media (max-width: 760px)';

const blink = stylex.keyframes({ '50%': { opacity: 0 } });
const wipeClip = stylex.keyframes({ from: { transform: 'translateX(-100%)' } });
const wipeLine = stylex.keyframes({ from: { transform: 'translateX(100%)' } });

const styles = stylex.create({
  landing: {
    minHeight: '100vh',
    overflowX: 'clip',
    backgroundColor: colors['--bg'],
    color: colors['--ink'],
  },
  inner: {
    maxWidth: 1040,
    marginBlock: 0,
    marginInline: 'auto',
    paddingBlock: 0,
    paddingInline: {
      default: 40,
      [NARROW]: 20,
    },
  },
  link: {
    color: 'inherit',
    textDecorationLine: 'none',
  },
  /* ---------- top bar ---------- */
  top: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: {
      default: 72,
      [NARROW]: 60,
    },
  },
  wordmark: {
    fontSize: 19,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  wordmarkCaret: {
    display: 'inline-block',
    width: 2,
    height: 18,
    marginLeft: 3,
    verticalAlign: '-3px',
    backgroundColor: colors['--ai'],
    animationName: blink,
    animationDuration: '1.1s',
    animationTimingFunction: 'steps(1)',
    animationIterationCount: 'infinite',
  },
  nav: {
    display: 'flex',
    gap: 22,
    fontSize: 14,
  },
  navLink: {
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
  },
  /* ---------- hero ---------- */
  hero: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1.05fr) minmax(0, 1fr)',
      [NARROW]: '1fr',
    },
    gap: {
      default: 28,
      [NARROW]: 8,
    },
    alignItems: 'center',
    paddingTop: {
      default: 48,
      [NARROW]: 28,
    },
    paddingInline: 0,
    paddingBottom: {
      default: 40,
      [NARROW]: 8,
    },
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 30,
    marginTop: 0,
    marginInline: 0,
    marginBottom: 20,
    paddingTop: 0,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 999,
    backgroundColor: `color-mix(in srgb, ${landing['--card']} 80%, transparent)`,
    color: colors['--muted'],
    fontSize: '12.5px',
    fontWeight: 600,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: landing['--you'],
  },
  headline: {
    fontSize: {
      default: 58,
      [NARROW]: 48,
    },
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: '-0.04em',
  },
  typing: {
    position: 'relative',
    whiteSpace: 'nowrap',
  },
  /* The underline wipes in: the clip slides right while the line counter-slides. */
  underline: {
    position: 'absolute',
    left: '-2%',
    bottom: -16,
    width: '104%',
    height: 26,
    overflow: 'hidden',
    animationName: wipeClip,
    animationDuration: '1.1s',
    animationDelay: '0.4s',
    animationTimingFunction: 'cubic-bezier(0.6, 0, 0.2, 1)',
    animationFillMode: 'both',
  },
  underlineLine: {
    display: 'block',
    height: '100%',
    animationName: wipeLine,
    animationDuration: '1.1s',
    animationDelay: '0.4s',
    animationTimingFunction: 'cubic-bezier(0.6, 0, 0.2, 1)',
    animationFillMode: 'both',
  },
  underlineSvg: {
    display: 'block',
    width: '100%',
    height: '100%',
    overflow: 'visible',
  },
  underlinePath: {
    fill: 'none',
    stroke: colors['--ai'],
    strokeWidth: 5,
    strokeLinecap: 'round',
  },
  lede: {
    maxWidth: '28em',
    marginTop: 26,
    marginInline: 0,
    marginBottom: 0,
    color: colors['--muted'],
    fontSize: {
      default: 18,
      [NARROW]: 17,
    },
    lineHeight: 1.55,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 28,
  },
  /* ---------- buttons ---------- */
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 46,
    borderRadius: 14,
    fontSize: 15,
    fontWeight: 650,
    whiteSpace: 'nowrap',
    transform: {
      default: null,
      ':hover': 'translateY(-1px)',
    },
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: motion['--ease'],
  },
  primary: {
    gap: 10,
    paddingTop: 0,
    paddingRight: 14,
    paddingBottom: 0,
    paddingLeft: 18,
    backgroundColor: colors['--btn'],
    color: colors['--btn-ink'],
    boxShadow: `0 1px 0 color-mix(in srgb, ${colors['--btn-ink']} 15%, transparent) inset, 0 8px 20px -8px ${landing['--button-shadow']}`,
  },
  primaryKey: {
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: 6,
    backgroundColor: `color-mix(in srgb, ${colors['--btn-ink']} 16%, transparent)`,
    fontFamily: fonts['--sans'],
    fontSize: '11.5px',
    fontWeight: 600,
  },
  secondary: {
    gap: 8,
    paddingBlock: 0,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    backgroundColor: landing['--card'],
    color: colors['--ink'],
  },
  sparkle: {
    width: 14,
    height: 14,
    color: colors['--ai'],
  },
  /* ---------- for Lexical developers ---------- */
  developers: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 0.9fr) minmax(0, 1.2fr)',
      [NARROW]: '1fr',
    },
    gap: 40,
    alignItems: 'start',
  },
  devList: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 18,
    paddingLeft: 22,
    fontSize: 16,
    lineHeight: 1.9,
  },
  devLink: {
    textDecorationLine: {
      default: 'none',
      ':hover': 'underline',
    },
    textDecorationThickness: {
      default: null,
      ':hover': 'auto',
    },
    textDecorationColor: {
      default: null,
      ':hover': colors['--rule-strong'],
    },
    textUnderlineOffset: {
      default: null,
      ':hover': '0.2em',
    },
  },
  underlineLink: {
    display: 'inline-block',
    paddingBottom: 2,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--ai'],
    fontSize: 15,
    fontWeight: 650,
  },
  code: {
    '--scrollbar': landing['--code-scrollbar'],
    margin: 0,
    paddingBlock: 18,
    paddingInline: 20,
    overflow: 'auto',
    borderRadius: 14,
    backgroundColor: landing['--code-bg'],
    color: landing['--code-ink'],
    fontFamily: fonts['--mono'],
    fontSize: {
      default: 13,
      [NARROW]: 12,
    },
    fontStyle: 'normal',
    fontWeight: 'normal',
    fontVariantNumeric: 'normal',
    lineHeight: 1.65,
  },
  codeKeyword: {
    color: landing['--code-keyword'],
  },
  codeString: {
    color: landing['--code-string'],
  },
  /* ---------- questions ---------- */
  faq: {
    display: 'grid',
    gridTemplateColumns: {
      default: '1fr 1fr',
      [NARROW]: '1fr',
    },
    rowGap: 0,
    columnGap: 40,
    margin: 0,
  },
  question: {
    paddingBlock: 18,
    paddingInline: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors['--rule'],
  },
  questionTitle: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 6,
    fontSize: 16,
    fontWeight: 650,
  },
  answer: {
    margin: 0,
    color: colors['--muted'],
    fontSize: 15,
    lineHeight: 1.55,
  },
  /* ---------- the ending ---------- */
  ending: {
    paddingTop: {
      default: 90,
      [NARROW]: 72,
    },
    paddingInline: 0,
    paddingBottom: 20,
    textAlign: 'center',
  },
  endingTitle: {
    maxWidth: '12em',
    marginTop: 0,
    marginInline: 'auto',
    marginBottom: 12,
    fontSize: {
      default: 52,
      [NARROW]: 36,
    },
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: '-0.035em',
  },
  endingText: {
    margin: 0,
    color: colors['--muted'],
    fontSize: 17,
  },
  endingActions: {
    justifyContent: 'center',
  },
  /* ---------- the footer ---------- */
  foot: {
    display: 'grid',
    gridTemplateColumns: {
      default: '1.4fr 1fr 1fr 1fr',
      [NARROW]: '1fr 1fr',
    },
    rowGap: {
      default: 20,
      [NARROW]: 24,
    },
    columnGap: 20,
    marginTop: 44,
    paddingTop: 22,
    paddingInline: 0,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors['--rule'],
    fontSize: '13.5px',
  },
  footTitle: {
    display: 'block',
    marginBottom: 8,
    fontSize: 13,
  },
  footItem: {
    display: 'block',
    paddingBlock: 3,
    paddingInline: 0,
    color: colors['--muted'],
  },
  footLink: {
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
  },
  footBrand: {
    marginBottom: 6,
    paddingBlock: 0,
    color: colors['--ink'],
    fontSize: 17,
    fontWeight: 700,
  },
});

function platform(): string {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || navigator.userAgent;
}

export function Landing() {
  const newCard = useRef<HTMLAnchorElement>(null);
  const exampleCard = useRef<HTMLAnchorElement>(null);
  const startNew = () => void openNote(newNotePath, newCard.current);
  const openExample = () => void openNote(EXAMPLE_PATH, exampleCard.current);
  const shortcut = startShortcutLabel(platform());
  // The landing page's own token set: "Clean" in light, "Night" in dark (D07).
  const scope = useThemeName() === 'dark' ? [landingDark, landingCardsDark] : landingLight;

  useEffect(() => {
    document.title = 'jot · Just start typing';
  }, []);

  // The page behind the landing page (overscroll, the view transition's
  // backdrop) takes its colour while it is mounted. <body> is outside React,
  // so no StyleX class can reach it.
  useLayoutEffect(() => {
    document.body.style.setProperty('background', colors['--landing-bg']);
    return () => {
      document.body.style.removeProperty('background');
    };
  }, []);

  useEffect(() => {
    // ⌘↵ anywhere, or any printable key outside a field, starts a note.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      // A held ⌘ or Ctrl is likely ⌘↵ on its way: fetch the editor now.
      if (event.key === 'Meta' || event.key === 'Control') {
        prefetchNotePage();
      }
      const action = landingKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.isComposing,
        target: classifyTarget(event.target),
      });
      if (action === 'start') {
        event.preventDefault();
        void openNote(newNotePath, newCard.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startButton = (
    <button
      type="button"
      {...stylex.props(styles.button, styles.primary)}
      aria-keyshortcuts="Meta+Enter Control+Enter"
      onClick={startNew}
      onPointerEnter={prefetchNotePage}
      onFocus={prefetchNotePage}
    >
      Start a new note{' '}
      <kbd {...stylex.props(styles.primaryKey)} aria-hidden="true">
        {shortcut}
      </kbd>
    </button>
  );

  return (
    <div {...stylex.props(styles.landing, scope)}>
      <div {...stylex.props(styles.inner)}>
        <header {...stylex.props(styles.top)}>
          <a {...stylex.props(styles.link, styles.wordmark)} href="/" aria-label="jot, home">
            jot
            <span {...stylex.props(styles.wordmarkCaret)} aria-hidden="true" />
          </a>
          <nav {...stylex.props(styles.nav)} aria-label="Site">
            <a {...stylex.props(styles.link, styles.navLink)} href={DOCS.home}>
              Docs
            </a>
            <a {...stylex.props(styles.link, styles.navLink)} href={GITHUB_URL}>
              GitHub
            </a>
          </nav>
        </header>

        <main>
          <section {...stylex.props(styles.hero)} aria-labelledby="hero-title">
            <div>
              <p {...stylex.props(styles.chip)}>
                <i {...stylex.props(styles.chipDot)} aria-hidden="true" />
                Live · Lexical + Yjs 14 playground
              </p>
              <h1 id="hero-title" {...stylex.props(styles.headline)}>
                Just start <br />
                <span {...stylex.props(styles.typing)}>
                  typing.
                  <Underline />
                </span>
              </h1>
              <p {...stylex.props(styles.lede)}>
                A note anyone with the link can edit at the same time, with people and an AI on your
                device.
              </p>
              <div {...stylex.props(styles.actions)}>
                {startButton}
                <button
                  type="button"
                  {...stylex.props(styles.button, styles.secondary)}
                  onClick={openExample}
                  onPointerEnter={prefetchNotePage}
                  onFocus={prefetchNotePage}
                >
                  <SparkleIcon xstyle={styles.sparkle} />
                  See the example
                </button>
              </div>
              <JoinField />
            </div>
            <Fan
              newCard={newCard}
              exampleCard={exampleCard}
              onNew={startNew}
              onExample={openExample}
            />
          </section>

          <TwoWindows />
          <EngineTabs />

          <section
            {...stylex.props(section.section, styles.developers)}
            aria-labelledby="dev-title"
          >
            <div>
              <p {...stylex.props(section.eyebrow)}>For Lexical developers</p>
              <h2 id="dev-title" {...stylex.props(section.title)}>
                Read the code that matters.
              </h2>
              <ol {...stylex.props(styles.devList)}>
                <li>
                  <a {...stylex.props(styles.link, styles.devLink)} href={DOCS.quickStart}>
                    Quick start in about 20 lines
                  </a>
                </li>
                <li>
                  <a {...stylex.props(styles.link, styles.devLink)} href={DOCS.contentInYjs}>
                    How Lexical's tree lives in Yjs
                  </a>
                </li>
                <li>
                  <a {...stylex.props(styles.link, styles.devLink)} href={DOCS.relay}>
                    The relay on Cloudflare
                  </a>
                </li>
                <li>
                  <a {...stylex.props(styles.link, styles.devLink)} href={DOCS.blame}>
                    Blame with Yjs 14 attributions
                  </a>
                </li>
              </ol>
              <a {...stylex.props(styles.link, styles.underlineLink)} href={DOCS.home}>
                Read the docs →
              </a>
            </div>
            <QuickStartCode />
          </section>

          <section {...stylex.props(section.section)} aria-labelledby="faq-title">
            <p {...stylex.props(section.eyebrow)} id="faq-title">
              Questions
            </p>
            <dl {...stylex.props(styles.faq)}>
              <Question q="Is my note private?">
                Anyone with the link can read and edit it, so don't paste anything secret.
              </Question>
              <Question q="How long do notes last?">
                90 days after the last visit. Each visit resets the clock.
              </Question>
              <Question q="What is Yjs 14?">
                The next major version of Yjs, the CRDT library behind many collaborative editors.
                jot runs on its release candidate.
              </Question>
              <Question q="Can I run my own?">
                Yes. jot is MIT licensed, and deploys to a free Cloudflare account with one command.
              </Question>
            </dl>
          </section>

          <section {...stylex.props(styles.ending)} aria-labelledby="end-title">
            <h2 id="end-title" {...stylex.props(styles.endingTitle)}>
              Try it, then see how it works.
            </h2>
            <p {...stylex.props(styles.endingText)}>
              Open a note in two windows, or read the code behind it.
            </p>
            <div {...stylex.props(styles.actions, styles.endingActions)}>
              {startButton}
              <a {...stylex.props(styles.link, styles.button, styles.secondary)} href={DOCS.home}>
                Read the docs →
              </a>
            </div>
          </section>
        </main>

        <footer {...stylex.props(styles.foot)}>
          <div>
            <span {...stylex.props(styles.footItem, styles.footBrand)}>jot</span>
            <span {...stylex.props(styles.footItem)}>© 2026 Gerard Rovira · MIT License</span>
          </div>
          <FooterColumn title="Product">
            <FooterLink href={NEW_NOTE_PATH} onClick={(event) => plainClick(startNew)(event)}>
              New note
            </FooterLink>
            <FooterLink href={EXAMPLE_PATH} onClick={(event) => plainClick(openExample)(event)}>
              Example
            </FooterLink>
          </FooterColumn>
          <FooterColumn title="Learn">
            <FooterLink href={DOCS.home}>Docs</FooterLink>
            <FooterLink href={DOCS.quickStart}>Quick start</FooterLink>
            <FooterLink href={DOCS.contentInYjs}>Content in Yjs</FooterLink>
          </FooterColumn>
          <FooterColumn title="Built on">
            <FooterLink href={LEXICAL_URL}>Lexical</FooterLink>
            <FooterLink href={YJS_URL}>Yjs 14</FooterLink>
            <FooterLink href={GITHUB_URL}>GitHub</FooterLink>
          </FooterColumn>
        </footer>
      </div>
    </div>
  );
}

/** The hand-drawn line under "typing.", wiped in once from the left. */
function Underline() {
  return (
    <span {...stylex.props(styles.underline)} aria-hidden="true">
      <span {...stylex.props(styles.underlineLine)}>
        <svg
          {...stylex.props(styles.underlineSvg)}
          viewBox="0 -2 300 26"
          preserveAspectRatio="none"
        >
          <path
            {...stylex.props(styles.underlinePath)}
            d="M4 14 C 60 4, 120 20, 180 10 S 270 6, 296 12"
          />
        </svg>
      </span>
    </span>
  );
}

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.question)}>
      <dt {...stylex.props(styles.questionTitle)}>{q}</dt>
      <dd {...stylex.props(styles.answer)}>{children}</dd>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <b {...stylex.props(styles.footTitle)}>{title}</b>
      {children}
    </nav>
  );
}

function FooterLink(props: ComponentProps<'a'>) {
  return <a {...props} {...stylex.props(styles.link, styles.footItem, styles.footLink)} />;
}

const QUICK_START = `const doc = createYDoc();
const editor = buildEditorFromExtensions(
  defineExtension({
    name: 'jot/note',
    dependencies: [
      RichTextExtension,
      configExtension(YCollabExtension, {doc, schemaVersion: 1}),
    ],
  }),
);
provider.on('sync', (synced) => {
  if (synced) binding.initialize();
});`;

const TOKENS = /('[^'\n]*')|\b(const|new|if)\b/g;

/** The quick-start snippet with keywords and strings tinted. */
function QuickStartCode() {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of QUICK_START.matchAll(TOKENS)) {
    parts.push(QUICK_START.slice(last, match.index));
    parts.push(
      <span key={match.index} {...stylex.props(match[1] ? styles.codeString : styles.codeKeyword)}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(QUICK_START.slice(last));
  return (
    <pre {...stylex.props(styles.code)} aria-label="Quick start">
      <code>{parts}</code>
    </pre>
  );
}
