import './docs.css';

import * as stylex from '@stylexjs/stylex';
import { type ComponentType, useEffect, useState } from 'react';

import { redirect } from '../router';
import { useThemeName } from '../theme';
import { docsDark } from '../theme/themes';
import { Ai, Blame, Size } from './content/features';
import { ContentInYjs, Offline, Presence } from './content/concepts';
import { Relay, ServerSideEditing } from './content/server';
import { QuickStart, Welcome } from './content/start';
import { DOCS_GROUPS, DOCS_PAGES, docsPath, findDocsPage, neighbours } from './pages';
import { LEXICAL_Y_README, REPO_URL } from './sources';
import { followLink } from './ui';

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
    <div className={`docs ${stylex.props(theme === 'dark' && docsDark).className ?? ''}`}>
      <header className="docs-head">
        <a className="docs-brand" href="/">
          jot<em>docs</em>
        </a>
        <nav className="docs-head-links" aria-label="Docs links">
          <a href="/docs" onClick={(event) => followLink(event, '/docs')}>
            Guides
          </a>
          <a href={LEXICAL_Y_README}>API</a>
          <a href={REPO_URL}>GitHub</a>
        </nav>
        <button
          type="button"
          className="docs-menu-button"
          aria-expanded={menuOpen}
          aria-controls="docs-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Pages'}
        </button>
      </header>
      <div className="docs-body">
        <nav
          id="docs-nav"
          className={`docs-nav${menuOpen ? ' is-open' : ''}`}
          aria-label="Docs pages"
          data-testid="docs-nav"
        >
          {DOCS_GROUPS.map((group) => (
            <div key={group} className="docs-nav-group">
              <p>{group}</p>
              <ul>
                {DOCS_PAGES.filter((item) => item.group === group).map((item) => {
                  const path = docsPath(item.slug);
                  const current = item.slug === slug;
                  return (
                    <li key={item.slug}>
                      <a
                        href={path}
                        aria-current={current ? 'page' : undefined}
                        onClick={(event) => followLink(event, path)}
                      >
                        <i className={`is-${item.tint}`} aria-hidden="true" />
                        {item.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main className="docs-main" data-testid="docs-main">
          <article className="docs-article">
            <Content />
          </article>
          <nav className="docs-pager" aria-label="Previous and next">
            {previous !== undefined ? (
              <a
                href={docsPath(previous.slug)}
                rel="prev"
                onClick={(event) => followLink(event, docsPath(previous.slug))}
              >
                <span>Previous</span>
                <b>{previous.title}</b>
              </a>
            ) : (
              <span />
            )}
            {next !== undefined && (
              <a
                className="is-next"
                href={docsPath(next.slug)}
                rel="next"
                onClick={(event) => followLink(event, docsPath(next.slug))}
              >
                <span>Next</span>
                <b>{next.title}</b>
              </a>
            )}
          </nav>
        </main>
      </div>
    </div>
  );
}
