import * as stylex from '@stylexjs/stylex';
import { type ComponentType, useEffect, useState } from 'react';

import { redirect } from '../router';
import { useThemeName } from '../theme';
import { docsDark } from '../theme/themes';
import { colors } from '../theme/tokens.stylex';
import { Ai, Blame, Size } from './content/features';
import { ContentInYjs, Offline, Presence } from './content/concepts';
import { Relay, ServerSideEditing } from './content/server';
import { QuickStart, Welcome } from './content/start';
import { DOCS_GROUPS, DOCS_PAGES, docsPath, findDocsPage, neighbours } from './pages';
import { LEXICAL_Y_README, REPO_URL } from './sources';
import { followLink } from './ui';
import { TINT } from './tint';

const CONTENT: Record<string, ComponentType> = {
  '': Welcome,
  'quick-start': QuickStart,
  'content-in-yjs': ContentInYjs,
  presence: Presence,
  offline: Offline,
  blame: Blame,
  ai: Ai,
  size: Size,
  relay: Relay,
  'server-side-editing': ServerSideEditing,
};

/** `/docs` and `/docs/<slug>`: the header, the grouped nav, the page, then Previous and Next. */
export default function DocsPage({ slug }: { slug: string }) {
  const page = findDocsPage(slug);
  const Content = CONTENT[slug];
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useThemeName();

  useEffect(() => {
    if (page === undefined) {
      redirect('/docs');
      return;
    }
    document.title = page.slug === '' ? 'jot docs' : `${page.title} · jot docs`;
  }, [page]);

  // A new page closes the narrow-screen menu.
  const [shownSlug, setShownSlug] = useState(slug);
  if (shownSlug !== slug) {
    setShownSlug(slug);
    setMenuOpen(false);
  }

  if (page === undefined || Content === undefined) {
    return null;
  }
  const { previous, next } = neighbours(slug);

  return (
    <div {...stylex.props(styles.root, theme === 'dark' && docsDark)}>
      <header {...stylex.props(styles.head)}>
        <a href="/" {...stylex.props(styles.brand)}>
          jot<em {...stylex.props(styles.brandDocs)}>docs</em>
        </a>
        <nav aria-label="Docs links" {...stylex.props(styles.headLinks)}>
          <a
            href="/docs"
            onClick={(event) => followLink(event, '/docs')}
            {...stylex.props(styles.headLink, styles.guides)}
          >
            Guides
          </a>
          <a href={LEXICAL_Y_README} {...stylex.props(styles.headLink)}>
            API
          </a>
          <a href={REPO_URL} {...stylex.props(styles.headLink)}>
            GitHub
          </a>
        </nav>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="docs-nav"
          onClick={() => setMenuOpen((open) => !open)}
          {...stylex.props(styles.menuButton)}
        >
          {menuOpen ? 'Close' : 'Pages'}
        </button>
      </header>
      <div {...stylex.props(styles.body)}>
        <nav
          id="docs-nav"
          aria-label="Docs pages"
          data-testid="docs-nav"
          {...stylex.props(styles.nav, menuOpen && styles.navOpen)}
        >
          {DOCS_GROUPS.map((group, index) => (
            <div key={group} {...stylex.props(index > 0 && styles.groupNext)}>
              <p {...stylex.props(styles.groupLabel)}>{group}</p>
              <ul {...stylex.props(styles.list)}>
                {DOCS_PAGES.filter((item) => item.group === group).map((item) => {
                  const path = docsPath(item.slug);
                  const current = item.slug === slug;
                  return (
                    <li key={item.slug}>
                      <a
                        href={path}
                        aria-current={current ? 'page' : undefined}
                        onClick={(event) => followLink(event, path)}
                        {...stylex.props(styles.navLink, current && styles.navLinkCurrent)}
                      >
                        <i aria-hidden="true" {...stylex.props(styles.dot, TINT[item.tint])} />
                        {item.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main data-testid="docs-main" {...stylex.props(styles.main)}>
          <article {...stylex.props(styles.article)}>
            <Content />
          </article>
          <nav aria-label="Previous and next" {...stylex.props(styles.pager)}>
            {previous !== undefined ? (
              <a
                href={docsPath(previous.slug)}
                rel="prev"
                onClick={(event) => followLink(event, docsPath(previous.slug))}
                {...stylex.props(styles.pagerLink)}
              >
                <span {...stylex.props(styles.pagerLabel)}>Previous</span>
                <b {...stylex.props(styles.pagerTitle)}>{previous.title}</b>
              </a>
            ) : (
              <span {...stylex.props(styles.pagerLabel, styles.pagerGap)} />
            )}
            {next !== undefined && (
              <a
                href={docsPath(next.slug)}
                rel="next"
                onClick={(event) => followLink(event, docsPath(next.slug))}
                {...stylex.props(styles.pagerLink, styles.pagerNext)}
              >
                <span {...stylex.props(styles.pagerLabel)}>Next</span>
                <b {...stylex.props(styles.pagerTitle)}>{next.title}</b>
              </a>
            )}
          </nav>
        </main>
      </div>
    </div>
  );
}

const NARROW = '@media (max-width: 860px)';
const HEAD = 56;

const styles = stylex.create({
  root: {
    minHeight: '100vh',
    backgroundColor: colors['--bg'],
    color: colors['--ink'],
  },
  head: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: { default: 24, [NARROW]: 16 },
    height: HEAD,
    paddingBlock: 0,
    paddingInline: { default: 24, [NARROW]: 16 },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--rule'],
    backgroundColor: colors['--bg'],
  },
  brand: {
    color: colors['--ink'],
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    textDecoration: 'none',
  },
  brandDocs: {
    marginLeft: 6,
    color: colors['--muted'],
    fontStyle: 'normal',
    fontWeight: 500,
  },
  headLinks: {
    display: 'flex',
    gap: 20,
    marginLeft: 'auto',
    fontSize: 14,
  },
  headLink: {
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
    textDecoration: 'none',
  },
  // Under 860px the header keeps API and GitHub; the nav has the pages.
  guides: {
    display: { default: null, [NARROW]: 'none' },
  },
  menuButton: {
    display: { default: 'none', [NARROW]: 'block' },
    height: 32,
    paddingBlock: 0,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
  },
  body: {
    display: 'grid',
    gridTemplateColumns: { default: '248px minmax(0, 1fr)', [NARROW]: 'minmax(0, 1fr)' },
    maxWidth: 1280,
    marginBlock: 0,
    marginInline: 'auto',
  },
  nav: {
    display: { default: null, [NARROW]: 'none' },
    position: { default: 'sticky', [NARROW]: 'static' },
    top: HEAD,
    alignSelf: 'start',
    height: { default: `calc(100vh - ${HEAD}px)`, [NARROW]: 'auto' },
    overflow: 'auto',
    paddingTop: { default: 24, [NARROW]: 12 },
    paddingInline: { default: 14, [NARROW]: 12 },
    paddingBottom: { default: 32, [NARROW]: 18 },
    borderRightWidth: { default: 1, [NARROW]: 0 },
    borderRightStyle: { default: 'solid', [NARROW]: 'none' },
    borderRightColor: { default: colors['--rule'], [NARROW]: 'currentcolor' },
    borderBottomWidth: { default: null, [NARROW]: 1 },
    borderBottomStyle: { default: null, [NARROW]: 'solid' },
    borderBottomColor: { default: null, [NARROW]: colors['--rule'] },
    fontSize: 14,
  },
  navOpen: {
    display: { default: null, [NARROW]: 'block' },
  },
  groupNext: {
    marginTop: 18,
  },
  groupLabel: {
    marginTop: 0,
    marginInline: 8,
    marginBottom: 6,
    color: colors['--muted'],
    fontSize: 11.5,
    fontWeight: 650,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: 8,
    backgroundColor: {
      default: null,
      ':hover': colors['--hover'],
    },
    color: colors['--ink'],
    textDecoration: 'none',
  },
  navLinkCurrent: {
    backgroundColor: colors['--hover'],
    fontWeight: 600,
  },
  dot: {
    flex: 'none',
    width: 7,
    height: 7,
    borderRadius: 2,
  },
  main: {
    minWidth: 0,
    paddingTop: { default: 40, [NARROW]: 28 },
    paddingInline: { default: 56, [NARROW]: 20 },
    paddingBottom: { default: 80, [NARROW]: 56 },
  },
  article: {
    maxWidth: 720,
  },
  pager: {
    display: 'flex',
    gap: 12,
    maxWidth: 720,
    marginTop: 56,
  },
  pagerLink: {
    flex: 1,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 12,
    backgroundColor: {
      default: null,
      ':hover': colors['--hover'],
    },
    color: colors['--ink'],
    textDecoration: 'none',
  },
  pagerNext: {
    textAlign: 'right',
  },
  pagerLabel: {
    display: 'block',
    color: colors['--muted'],
    fontSize: 13,
  },
  // Holds Next on the right when there's no Previous.
  pagerGap: {
    flex: 1,
  },
  pagerTitle: {
    display: 'block',
    fontSize: 15,
    fontWeight: 620,
  },
});
