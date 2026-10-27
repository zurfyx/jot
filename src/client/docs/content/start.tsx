import * as stylex from '@stylexjs/stylex';

import { colors, docs } from '../../theme/tokens.stylex';
import { Code } from '../Code';
import { DOCS_PAGES, docsPath } from '../pages';
import { LEXICAL_Y_README, LEXICAL_Y_SOURCE, REPO_URL, SNIPPETS } from '../sources';
import { TINT } from '../tint';
import { C, Callout, DocLink, followLink, H1, H2, P, PageHeader, prose, Source } from '../ui';

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
      <header {...stylex.props(styles.hero)}>
        <P>jot docs</P>
        <H1>Learn collaborative Lexical</H1>
        <P xstyle={styles.heroLast}>
          jot is a small, real app on <C>@lexical/y</C>, Lexical's collaboration binding for Yjs 14.
          These pages show the few pieces of code that matter, with links to{' '}
          <a href={REPO_URL}>the source on GitHub</a> and to{' '}
          <a href={LEXICAL_Y_README}>
            <C>@lexical/y</C>'s README
          </a>{' '}
          for the full API.
        </P>
      </header>
      <ul {...stylex.props(prose.list, styles.topics)}>
        {TOPICS.map((slug) => {
          const page = DOCS_PAGES.find((candidate) => candidate.slug === slug);
          if (page === undefined) {
            return null;
          }
          const path = docsPath(slug);
          return (
            <li key={slug} {...stylex.props(prose.text, styles.topic)}>
              <a
                href={path}
                onClick={(event) => followLink(event, path)}
                {...stylex.props(styles.topicLink)}
              >
                <span aria-hidden="true" {...stylex.props(styles.glyph, TINT[page.tint])}>
                  {GLYPHS[slug]}
                </span>
                <span>
                  <b {...stylex.props(prose.b, styles.topicTitle)}>{page.title}</b>
                  <span {...stylex.props(styles.topicBlurb)}>{page.blurb}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <H2>What jot is</H2>
      <P>
        A full-page note anyone with the link can edit at the same time. One Cloudflare Worker
        serves the app, and one Durable Object per note relays Yjs updates and stores the note. jot
        is a playground for the engine, so every feature is there to make it visible.
      </P>
      <P>
        Every snippet in these pages is a TypeScript file in the repo, type-checked with the app,
        and the excerpts of jot's own code are cut from the files themselves. When the code changes,
        the docs change with it.
      </P>
    </>
  );
}

export function QuickStart() {
  return (
    <>
      <PageHeader crumb="Start / Quick start" title="Quick start" />
      <P>
        Give the editor a Yjs document through <C>YCollabExtension</C>, connect the document to a
        provider, and initialize the binding after the provider's first sync. That's the whole
        integration.
      </P>
      <Code source={SNIPPETS.quickStart} />
      <P>
        Any Yjs 14 provider works with the binding. This one talks to jot's relay, which speaks the
        y-websocket protocol plus one message of its own (type 64, the note's stored size and
        whether an update was refused). A stock <C>@y/websocket</C> provider doesn't know that type:
        it misreads the rest of the frame and throws, so the snippet reads it. The room must be a
        jot note id, 22 base64url characters: the relay answers anything else with a 400, and the
        provider would retry forever.
      </P>
      <Callout title="Why wait for the first sync?">
        Initializing earlier would write an empty note on top of content you haven't received yet.
        After the sync, <C>initialize()</C> reads the note, or seeds an empty one. The seed's client
        id is derived from its content, so two people opening a new note at once write the same
        items, and the note gets one copy.
      </Callout>
      <H2>In jot</H2>
      <P>
        <Source path="src/client/editor/session.ts" /> does the same with jot's full set of
        extensions (lists, checklists, links, code blocks, tables, markdown shortcuts) from{' '}
        <Source path="src/client/editor/extensions.ts">extensions.ts</Source>. The provider runs
        without a BroadcastChannel, so tabs sync through the server, which enforces the size cap,
        and it adopts an <C>Awareness</C> the session owns. A new note is shared from the start: it
        opens at its own <C>/n/&lt;id&gt;</C>, connects, and initializes after that first sync like
        any other.
      </P>
      <P>
        The extension's output also has a <C>status</C> signal: <C>'pending'</C> until the first
        sync, then <C>'active'</C>, or <C>'readonly'</C> when the binding can't write the note
        safely: a newer layout, content with no layout record, node types the editor doesn't
        register, a type recorded with a storage kind this editor can't use, or an older layout's
        root that needs converting. jot then says "Read only" and keeps the note readable.
      </P>
      <H2>Install</H2>
      <Code source={SNIPPETS.install} />
      <P>
        <C>@lexical/y</C> isn't on npm yet, so jot installs every Lexical package from the same
        pkg.pr.new build of its pull request; <C>pnpm bump-lexical &lt;pr-or-sha&gt;</C> moves the
        pin. <C>@y/y</C> is a peer dependency pinned to the release candidate the binding is tested
        with. Its type declarations don't type-check on their own, so set <C>skipLibCheck: true</C>.
      </P>
      <P>
        Next, see <DocLink slug="content-in-yjs">how the note is stored</DocLink>, or read the{' '}
        <a href={LEXICAL_Y_SOURCE}>binding's source</a>.
      </P>
    </>
  );
}

const NARROW = '@media (max-width: 860px)';

const styles = stylex.create({
  hero: {
    marginBottom: 20,
    paddingTop: { default: 30, [NARROW]: 22 },
    paddingInline: { default: 30, [NARROW]: 20 },
    paddingBottom: { default: 24, [NARROW]: 18 },
    borderRadius: 18,
    backgroundImage: `linear-gradient(120deg, ${docs['--docs-tint-you']}, ${docs['--docs-tint-ai']} 60%, ${docs['--docs-tint-ana']})`,
  },
  heroLast: {
    marginBottom: 0,
  },
  topics: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [NARROW]: 'minmax(0, 1fr)' },
    gap: 12,
    maxWidth: 'none',
    paddingLeft: 0,
    listStyleType: 'none',
  },
  topic: {
    margin: 0,
  },
  topicLink: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    height: '100%',
    paddingBlock: 14,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 14,
    backgroundColor: {
      default: null,
      ':hover': colors['--hover'],
    },
    color: colors['--ink'],
    textDecoration: 'none',
  },
  glyph: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 10,
    color: colors['--peer-ink'],
    fontSize: 15,
    fontWeight: 700,
  },
  topicTitle: {
    display: 'block',
    marginBottom: 2,
    fontSize: 15,
  },
  topicBlurb: {
    display: 'block',
    color: colors['--muted'],
    fontSize: 13.5,
    lineHeight: 1.5,
  },
});
