import type { MouseEvent, ReactNode } from 'react';

import { navigate } from '../router';
import { docsPath, findDocsPage } from './pages';
import { sourceUrl } from './sources';

/** Follows a same-tab click client-side; modified clicks open as usual. */
export function followLink(event: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(path);
}

/** A link to another docs page, by slug; its text defaults to the page's title. */
export function DocLink({ slug, children }: { slug: string; children?: ReactNode }) {
  const path = docsPath(slug);
  return (
    <a href={path} onClick={(event) => followLink(event, path)}>
      {children ?? findDocsPage(slug)?.title ?? slug}
    </a>
  );
}

export function Callout({
  title,
  tone = 'info',
  children,
}: {
  title: string;
  tone?: 'info' | 'warn';
  children: ReactNode;
}) {
  return (
    <aside className={`docs-callout is-${tone}`}>
      <b>{title}</b>
      <div>{children}</div>
    </aside>
  );
}

/** A file in jot's repo, linked on GitHub, shown in monospace. */
export function Source({ path, children }: { path: string; children?: ReactNode }) {
  return (
    <a className="docs-source" href={sourceUrl(path)}>
      <code>{children ?? path}</code>
    </a>
  );
}

export function PageHeader({ crumb, title }: { crumb: string; title: ReactNode }) {
  return (
    <header className="docs-page-head">
      <p className="docs-crumb">{crumb}</p>
      <h1>{title}</h1>
    </header>
  );
}
