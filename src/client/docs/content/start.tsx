import { Code } from '../Code';
import { DOCS_PAGES, docsPath } from '../pages';
import { LEXICAL_Y_API, LEXICAL_Y_DOCS, REPO_URL, SNIPPETS } from '../sources';
import { Callout, DocLink, followLink, PageHeader, Source } from '../ui';

const TOPICS = ['quick-start', 'content-in-yjs', 'blame', 'offline', 'relay', 'ai'];
const GLYPHS: Record<string, string> = {
  'quick-start': '1',
  'content-in-yjs': 'Y',
  blame: 'B',
  offline: '⇄',
  relay: '☁',
  ai: '✦',
};

export function Welcome() {
  return (
    <>
      <header className="docs-hero">
        <p className="docs-crumb">jot docs</p>
        <h1>Learn collaborative Lexical</h1>
        <p>
          jot is a small, real app on <code>@lexical/y</code>, Lexical's collaboration binding for
          Yjs 14. These pages show the few pieces of code that matter, with links to{' '}
          <a href={REPO_URL}>the source on GitHub</a> and to{' '}
          <a href={LEXICAL_Y_DOCS}>lexical.dev</a> for the full API.
        </p>
      </header>
      <ul className="docs-topics">
        {TOPICS.map((slug) => {
          const page = DOCS_PAGES.find((candidate) => candidate.slug === slug);
          if (page === undefined) {
            return null;
          }
          const path = docsPath(slug);
          return (
            <li key={slug}>
              <a href={path} onClick={(event) => followLink(event, path)}>
                <span className={`docs-glyph is-${page.tint}`} aria-hidden="true">
                  {GLYPHS[slug]}
                </span>
                <span>
                  <b>{page.title}</b>
                  <span>{page.blurb}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <h2>What jot is</h2>
      <p>
        A full-page note anyone with the link can edit at the same time. One Cloudflare Worker
        serves the app, and one Durable Object per note relays Yjs updates and stores the note. jot
        is a playground for the engine, so every feature is there to make it visible.
      </p>
      <p>
        Every snippet in these pages is a TypeScript file in the repo, type-checked with the app,
        and the excerpts of jot's own code are cut from the files themselves. When the code changes,
        the docs change with it.
      </p>
    </>
  );
}

export function QuickStart() {
  return (
    <>
      <PageHeader crumb="Start / Quick start" title="Quick start" />
      <p>
        Give the editor a Yjs document through <code>YCollabExtension</code>, connect the document
        to a provider, and initialize the binding after the provider's first sync. That's the whole
        integration.
      </p>
      <Code source={SNIPPETS.quickStart} />
      <Callout title="Why wait for the first sync?">
        Initializing earlier would write an empty note on top of content you haven't received yet.
        After the sync, <code>initialize()</code> reads the note, or seeds an empty one. The seed's
        client id is derived from its content, so two people opening a new note at once write the
        same items, and the note gets one copy.
      </Callout>
      <h2>In jot</h2>
      <p>
        <Source path="src/client/editor/session.ts" /> does the same with jot's full set of
        extensions (lists, checklists, links, code blocks, tables, markdown shortcuts) from{' '}
        <Source path="src/client/editor/extensions.ts">extensions.ts</Source>. The provider runs
        without a BroadcastChannel, so tabs sync through the server, which enforces the size cap,
        and it adopts an <code>Awareness</code> the session owns. A new note at <code>/new</code>{' '}
        has no provider at all until it's shared: see <DocLink slug="offline">drafts</DocLink>.
      </p>
      <p>
        The extension's output also has a <code>status</code> signal: <code>'pending'</code> until
        the first sync, then <code>'active'</code>, or <code>'readonly'</code> when the note was
        written in a newer layout than this binding writes. jot then says "Read only" and keeps the
        note readable.
      </p>
      <h2>Install</h2>
      <Code source={SNIPPETS.install} />
      <p>
        <code>@lexical/y</code> isn't on npm yet, so jot installs every Lexical package from the
        same pkg.pr.new build of its pull request; <code>pnpm bump-lexical &lt;pr-or-sha&gt;</code>{' '}
        moves the pin. <code>@y/y</code> is a peer dependency pinned to the release candidate the
        binding is tested with. Its type declarations don't type-check on their own, so set{' '}
        <code>skipLibCheck: true</code>.
      </p>
      <p>
        Next, see <DocLink slug="content-in-yjs">how the note is stored</DocLink>, or read the{' '}
        <a href={LEXICAL_Y_API}>API reference</a>.
      </p>
    </>
  );
}
