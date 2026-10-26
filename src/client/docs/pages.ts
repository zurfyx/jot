/**
 * The docs' table of contents: every page's slug, title and group, in reading
 * order. It holds no page content, so the landing page's tests can check its
 * links against it without loading the docs.
 */

export type DocsGroup = 'Start' | 'Concepts' | 'Features' | 'Server';

/** Which person's colour marks a page in the nav: you, Ana or jot AI. */
export type DocsTint = 'you' | 'ana' | 'ai';

export interface DocsPageInfo {
  /** '' is the docs home, `/docs`. */
  slug: string;
  title: string;
  group: DocsGroup;
  tint: DocsTint;
  /** One line for the docs home. */
  blurb: string;
}

export const DOCS_PAGES: readonly DocsPageInfo[] = [
  {
    slug: '',
    title: 'Welcome',
    group: 'Start',
    tint: 'you',
    blurb: 'What jot is, and what these pages cover.',
  },
  {
    slug: 'quick-start',
    title: 'Quick start',
    group: 'Start',
    tint: 'you',
    blurb: 'A collaborative Lexical editor in about 20 lines.',
  },
  {
    slug: 'content-in-yjs',
    title: 'How content lives in Yjs',
    group: 'Concepts',
    tint: 'ai',
    blurb: "Lexical's tree as Yjs text, line markers and nodes, with a live inspector.",
  },
  {
    slug: 'presence',
    title: 'Presence and cursors',
    group: 'Concepts',
    tint: 'ana',
    blurb: 'Names, colours and carets through Yjs awareness.',
  },
  {
    slug: 'offline',
    title: 'Offline and merging',
    group: 'Concepts',
    tint: 'ana',
    blurb: 'Edit apart, reconnect, and why nothing is lost.',
  },
  {
    slug: 'blame',
    title: 'Blame and history',
    group: 'Features',
    tint: 'ai',
    blurb: 'Who wrote what, from Yjs 14 attributions.',
  },
  {
    slug: 'ai',
    title: 'AI as a collaborator',
    group: 'Features',
    tint: 'ai',
    blurb: 'An on-device model that edits as its own peer.',
  },
  {
    slug: 'size',
    title: 'Size and limits',
    group: 'Features',
    tint: 'you',
    blurb: 'The 2 MB cap, compaction and the 90-day expiry.',
  },
  {
    slug: 'relay',
    title: 'The relay on Cloudflare',
    group: 'Server',
    tint: 'ana',
    blurb: 'One Durable Object per note, relaying Yjs 14 updates.',
  },
  {
    slug: 'server-side-editing',
    title: 'Server-side editing',
    group: 'Server',
    tint: 'ana',
    blurb: 'Seed, edit and read a note without a browser, with @lexical/y/headless.',
  },
];

export const DOCS_GROUPS: readonly DocsGroup[] = ['Start', 'Concepts', 'Features', 'Server'];

export function docsPath(slug: string): string {
  return slug === '' ? '/docs' : `/docs/${slug}`;
}

export function findDocsPage(slug: string): DocsPageInfo | undefined {
  return DOCS_PAGES.find((page) => page.slug === slug);
}

/** The pages before and after `slug` in reading order. */
export function neighbours(slug: string): {
  previous: DocsPageInfo | undefined;
  next: DocsPageInfo | undefined;
} {
  const index = DOCS_PAGES.findIndex((page) => page.slug === slug);
  if (index === -1) {
    return { previous: undefined, next: undefined };
  }
  return { previous: DOCS_PAGES[index - 1], next: DOCS_PAGES[index + 1] };
}
