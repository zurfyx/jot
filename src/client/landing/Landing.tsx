import { type ReactNode, useEffect, useRef } from 'react';

import { prefetchNotePage } from '../loadNote';
import { SparkleIcon } from './bits';
import { EngineTabs } from './EngineTabs';
import { Fan } from './Fan';
import { JoinField } from './JoinField';
import { classifyTarget, landingKeyAction, startShortcutLabel } from './keys';
import './landing.css';
import { EXAMPLE_PATH, NEW_NOTE_PATH, openNote, plainClick } from './open';
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

function platform(): string {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || navigator.userAgent;
}

export function Landing() {
  const newCard = useRef<HTMLAnchorElement>(null);
  const exampleCard = useRef<HTMLAnchorElement>(null);
  const startNew = () => void openNote(NEW_NOTE_PATH, newCard.current);
  const openExample = () => void openNote(EXAMPLE_PATH, exampleCard.current);
  const shortcut = startShortcutLabel(platform());

  useEffect(() => {
    document.title = 'jot · Just start typing';
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
        void openNote(NEW_NOTE_PATH, newCard.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startButton = (
    <button
      type="button"
      className="land-primary"
      aria-keyshortcuts="Meta+Enter Control+Enter"
      onClick={startNew}
      onPointerEnter={prefetchNotePage}
      onFocus={prefetchNotePage}
    >
      Start a new note <kbd aria-hidden="true">{shortcut}</kbd>
    </button>
  );

  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="land-top">
          <a className="wordmark" href="/" aria-label="jot, home">
            jot
            <span className="wordmark-caret" aria-hidden="true" />
          </a>
          <nav className="land-nav" aria-label="Site">
            <a href={DOCS.home}>Docs</a>
            <a href={GITHUB_URL}>GitHub</a>
          </nav>
        </header>

        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="live-chip">
                <i aria-hidden="true" />
                Live · Lexical + Yjs 14 playground
              </p>
              <h1 id="hero-title">
                Just start <br />
                <span className="hero-typing">
                  typing.
                  <Underline />
                </span>
              </h1>
              <p className="hero-lede">
                A note anyone with the link can edit at the same time, with people and an AI on your
                device.
              </p>
              <div className="hero-actions">
                {startButton}
                <button
                  type="button"
                  className="land-secondary"
                  onClick={openExample}
                  onPointerEnter={prefetchNotePage}
                  onFocus={prefetchNotePage}
                >
                  <SparkleIcon className="land-sparkle" />
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

          <section className="section developers" aria-labelledby="dev-title">
            <div>
              <p className="eyebrow">For Lexical developers</p>
              <h2 id="dev-title">Read the code that matters.</h2>
              <ol className="dev-list">
                <li>
                  <a href={DOCS.quickStart}>Quick start in about 20 lines</a>
                </li>
                <li>
                  <a href={DOCS.contentInYjs}>How Lexical's tree lives in Yjs</a>
                </li>
                <li>
                  <a href={DOCS.relay}>The relay on Cloudflare</a>
                </li>
                <li>
                  <a href={DOCS.blame}>Blame with Yjs 14 attributions</a>
                </li>
              </ol>
              <a className="underline-link" href={DOCS.home}>
                Read the docs →
              </a>
            </div>
            <QuickStartCode />
          </section>

          <section className="section questions" aria-labelledby="faq-title">
            <p className="eyebrow" id="faq-title">
              Questions
            </p>
            <dl className="faq">
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

          <section className="ending" aria-labelledby="end-title">
            <h2 id="end-title">Try it, then see how it works.</h2>
            <p>Open a note in two windows, or read the code behind it.</p>
            <div className="ending-actions">
              {startButton}
              <a className="land-secondary" href={DOCS.home}>
                Read the docs →
              </a>
            </div>
          </section>
        </main>

        <footer className="land-foot">
          <div>
            <span className="land-foot-brand">jot</span>
            <span>© 2026 Gerard Rovira · MIT License</span>
          </div>
          <FooterColumn title="Product">
            <a href={NEW_NOTE_PATH} onClick={(event) => plainClick(startNew)(event)}>
              New note
            </a>
            <a href={EXAMPLE_PATH} onClick={(event) => plainClick(openExample)(event)}>
              Example
            </a>
          </FooterColumn>
          <FooterColumn title="Learn">
            <a href={DOCS.home}>Docs</a>
            <a href={DOCS.quickStart}>Quick start</a>
            <a href={DOCS.contentInYjs}>Content in Yjs</a>
          </FooterColumn>
          <FooterColumn title="Built on">
            <a href={LEXICAL_URL}>Lexical</a>
            <a href={YJS_URL}>Yjs 14</a>
            <a href={GITHUB_URL}>GitHub</a>
          </FooterColumn>
        </footer>
      </div>
    </div>
  );
}

/** The hand-drawn line under "typing.", wiped in once from the left. */
function Underline() {
  return (
    <span className="hero-underline" aria-hidden="true">
      <span>
        <svg viewBox="0 -2 300 26" preserveAspectRatio="none">
          <path d="M4 14 C 60 4, 120 20, 180 10 S 270 6, 296 12" />
        </svg>
      </span>
    </span>
  );
}

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <dt>{q}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <b>{title}</b>
      {children}
    </nav>
  );
}

const QUICK_START = `const doc = new Y.Doc();
const editor = buildEditorFromExtensions(
  defineExtension({
    name: 'jot/note',
    dependencies: [
      RichTextExtension,
      configExtension(YCollabExtension, {doc}),
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
      <span key={match.index} className={match[1] ? 'code-string' : 'code-keyword'}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(QUICK_START.slice(last));
  return (
    <pre className="code-block" aria-label="Quick start">
      <code>{parts}</code>
    </pre>
  );
}
