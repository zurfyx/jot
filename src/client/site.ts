/**
 * What jot's public pages tell search engines and link previews (D31): the
 * site's address, the shape of a page's head, and the landing page's own.
 * The docs pages' heads are in heads.ts, beside the docs' table of contents,
 * so the landing page's bundle carries neither.
 */

export const SITE_URL = 'https://jot.rovira.sh';
export const SITE_NAME = 'jot';

export interface PageHead {
  /** The path, as linked: `/`, `/docs`, `/docs/blame`. */
  path: string;
  title: string;
  description: string;
  /** The link-preview card's heading and its kicker. */
  card: { kicker: string; heading: string };
  /** Which person's colour the card's dot takes (the docs nav's tint). */
  tint: 'you' | 'ana' | 'ai';
  /** The link-preview image, under public/: `/og/<name>.png`. */
  image: string;
  type: 'website' | 'article';
}

export const LANDING_HEAD: PageHead = {
  path: '/',
  title: 'jot · Just start typing',
  description:
    "A note anyone with the link can edit at the same time. A playground for Lexical's new collaboration engine on Yjs 14.",
  card: { kicker: 'jot', heading: 'Just start typing.' },
  tint: 'you',
  image: '/og/index.png',
  type: 'website',
};

/** The page a path that matches nothing gets, with a 404. */
export const NOT_FOUND_TITLE = 'Page not found · jot';

/** A path's absolute address on jot.rovira.sh (the canonical URL). */
export function siteUrl(path: string): string {
  return `${SITE_URL}${path === '/' ? '/' : path}`;
}
