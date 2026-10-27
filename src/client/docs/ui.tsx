import * as stylex from '@stylexjs/stylex';
import type { MouseEvent, ReactNode } from 'react';

import { navigate } from '../router';
import { colors, docs, fonts } from '../theme/tokens.stylex';
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

const NARROW = '@media (max-width: 860px)';

/**
 * The article's prose (docs/design.md, "Docs"): a 720px column, text capped
 * near 68 characters, short sections around one snippet each.
 */
export const prose = stylex.create({
  h1: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 12,
    fontSize: { default: 34, [NARROW]: 28 },
    lineHeight: 1.15,
    fontWeight: 680,
    letterSpacing: '-0.022em',
  },
  h2: {
    marginTop: 40,
    marginInline: 0,
    marginBottom: 10,
    fontSize: 21,
    lineHeight: 1.3,
    fontWeight: 650,
    letterSpacing: '-0.01em',
  },
  text: {
    color: colors['--body'],
    fontSize: 16,
    lineHeight: 1.7,
  },
  p: {
    maxWidth: '68ch',
    marginTop: 0,
    marginInline: 0,
    marginBottom: 14,
  },
  list: {
    maxWidth: '68ch',
    marginTop: 0,
    marginInline: 0,
    marginBottom: 14,
    paddingLeft: 22,
  },
  li: {
    marginBlock: 6,
    marginInline: 0,
  },
  b: {
    color: colors['--ink'],
    fontWeight: 620,
  },
  code: {
    paddingBlock: 1,
    paddingInline: 5,
    borderRadius: 5,
    backgroundColor: colors['--hover'],
    color: colors['--ink'],
    fontFamily: fonts['--mono'],
    fontSize: '0.86em',
  },
});

type Children = { children?: ReactNode };
type Styled = { xstyle?: stylex.StyleXStyles };

export function H1({ children }: Children) {
  return <h1 {...stylex.props(prose.h1)}>{children}</h1>;
}

export function H2({ children }: Children) {
  return <h2 {...stylex.props(prose.h2)}>{children}</h2>;
}

export function P({ children, xstyle }: Children & Styled) {
  return <p {...stylex.props(prose.text, prose.p, xstyle)}>{children}</p>;
}

export function Ul({ children }: Children) {
  return <ul {...stylex.props(prose.list)}>{children}</ul>;
}

export function Ol({ children }: Children) {
  return <ol {...stylex.props(prose.list)}>{children}</ol>;
}

export function Li({ children }: Children) {
  return <li {...stylex.props(prose.text, prose.li)}>{children}</li>;
}

export function B({ children }: Children) {
  return <b {...stylex.props(prose.b)}>{children}</b>;
}

/** Inline code: a name, a value or a path in the prose. */
export function C({ children, xstyle }: Children & Styled) {
  return <code {...stylex.props(prose.code, xstyle)}>{children}</code>;
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

const callout = stylex.create({
  box: {
    display: 'grid',
    gap: 2,
    maxWidth: '68ch',
    marginBlock: 18,
    marginInline: 0,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: docs['--docs-callout-rule'],
    borderRadius: 12,
    backgroundColor: docs['--docs-callout-bg'],
    color: colors['--body'],
    fontSize: 15,
    lineHeight: 1.6,
  },
  warn: {
    borderColor: docs['--docs-warn-rule'],
    backgroundColor: docs['--docs-warn-bg'],
  },
});

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
    <aside {...stylex.props(callout.box, tone === 'warn' && callout.warn)}>
      <B>{title}</B>
      <div>{children}</div>
    </aside>
  );
}

const source = stylex.create({
  link: {
    textDecoration: 'none',
  },
  code: {
    backgroundColor: {
      default: colors['--hover'],
      [stylex.when.ancestor(':hover')]: colors['--select'],
    },
  },
});

/** A link to a file or folder of jot's repo on GitHub, shown in monospace. */
export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} {...stylex.props(source.link, stylex.defaultMarker())}>
      <C xstyle={source.code}>{children}</C>
    </a>
  );
}

/** A file in jot's repo, linked on GitHub, shown in monospace. */
export function Source({ path, children }: { path: string; children?: ReactNode }) {
  return <SourceLink href={sourceUrl(path)}>{children ?? path}</SourceLink>;
}

export function PageHeader({ crumb, title }: { crumb: string; title: ReactNode }) {
  return (
    <header>
      <P>{crumb}</P>
      <H1>{title}</H1>
    </header>
  );
}
