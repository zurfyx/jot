import { LANDING_HEAD, NOT_FOUND_TITLE, type PageHead, SITE_NAME, siteUrl } from './site';

/**
 * A public page's head (D31), one way for both sides: the prerender writes
 * `headTags` into each page's HTML, and `applyHead` puts the same tags in
 * place when the app moves to another page without a reload, so the head
 * always matches the page.
 */

export interface MetaTag {
  attr: 'name' | 'property';
  key: string;
  content: string;
}

export interface HeadTags {
  title: string;
  description: string;
  canonical: string;
  meta: MetaTag[];
  structured: Record<string, unknown>;
}

export function headTags(head: PageHead): HeadTags {
  const url = siteUrl(head.path);
  const image = siteUrl(head.image);
  const tag = (attr: MetaTag['attr'], key: string, content: string) => ({ attr, key, content });
  return {
    title: head.title,
    description: head.description,
    canonical: url,
    meta: [
      tag('property', 'og:type', head.type),
      tag('property', 'og:site_name', SITE_NAME),
      tag('property', 'og:title', head.title),
      tag('property', 'og:description', head.description),
      tag('property', 'og:url', url),
      tag('property', 'og:image', image),
      tag('property', 'og:image:width', '1200'),
      tag('property', 'og:image:height', '630'),
      tag('name', 'twitter:card', 'summary_large_image'),
      tag('name', 'twitter:title', head.title),
      tag('name', 'twitter:description', head.description),
      tag('name', 'twitter:image', image),
    ],
    structured:
      head.path === '/'
        ? {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: SITE_NAME,
            url,
            description: head.description,
          }
        : {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: head.title,
            description: head.description,
            url,
            inLanguage: 'en',
            isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl('/') },
          },
  };
}

/** The tags a page's head carries for search engines and link previews, besides its title. */
const MANAGED =
  'link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"], meta[name="robots"], script[type="application/ld+json"]';

/**
 * Puts a page's head in place: a public page's tags, the 404 page's
 * (`noindex`, no canonical), or a note's (none of them, and its title left to
 * the note page). The entry chunk reaches it through syncHead.ts, on demand.
 */
export function applyHead(page: PageHead | 'landing' | 'not-found' | 'note'): void {
  const head = page === 'landing' ? LANDING_HEAD : page;
  const tags = typeof head === 'object' ? headTags(head) : null;
  if (tags !== null) {
    document.title = tags.title;
  } else if (head === 'not-found') {
    document.title = NOT_FOUND_TITLE;
  }
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', tags?.description ?? LANDING_HEAD.description);
  document.head.querySelectorAll(MANAGED).forEach((element) => element.remove());
  const add = (name: string, attributes: Record<string, string>, text?: string) => {
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, value);
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    document.head.append(element);
  };
  if (tags !== null) {
    add('link', { rel: 'canonical', href: tags.canonical });
    for (const { attr, key, content } of tags.meta) {
      add('meta', { [attr]: key, content });
    }
    add('script', { type: 'application/ld+json' }, JSON.stringify(tags.structured));
  } else if (head === 'not-found') {
    add('meta', { name: 'robots', content: 'noindex' });
  }
}
