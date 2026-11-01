import { DOCS_PAGES, docsPath } from './docs/pages';
import { LANDING_HEAD } from './head';
import type { PageHead } from './site';

/**
 * Every public page's head (D31): the landing page's and one per docs page,
 * from the docs' table of contents, with its title, description and preview
 * image. The prerender writes them into each page's head, the docs set their
 * title from them, and the link-preview cards are drawn from them.
 */

/** The docs pages' heads, in reading order. */
export const DOCS_HEADS: readonly PageHead[] = DOCS_PAGES.map((page) => ({
  path: docsPath(page.slug),
  title: page.slug === '' ? 'jot docs' : `${page.title} · jot docs`,
  description: page.blurb,
  card: {
    kicker: 'jot docs',
    heading: page.slug === '' ? 'Learn collaborative Lexical' : page.title,
  },
  tint: page.tint,
  image: page.slug === '' ? '/og/docs.png' : `/og/docs-${page.slug}.png`,
  type: 'article',
}));

/** Every public page: the landing page, then the docs. */
export const PAGE_HEADS: readonly PageHead[] = [LANDING_HEAD, ...DOCS_HEADS];

/** The head of the public page at `path`, if it is one. */
export function headFor(path: string): PageHead | undefined {
  return PAGE_HEADS.find((head) => head.path === path);
}
