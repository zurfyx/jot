import { SITE_URL } from '../shared/site';

/**
 * robots.txt and the sitemap (D17, D24, D32). Production answers only on
 * jot.rovira.sh; a branch Preview on workers.dev, where Cloudflare marks every
 * response noindex. A Preview keeps the same rules but names no sitemap, and
 * has none: the sitemap lists production's pages, not the Preview's.
 */

export function isPreview(url: URL): boolean {
  return url.hostname.endsWith('.workers.dev');
}

/** Notes, the API and the links that create a note stay out of crawlers' way (D17). */
export function robotsTxt(preview: boolean): string {
  const rules = ['User-agent: *', 'Disallow: /n/', 'Disallow: /api/', 'Disallow: /new'];
  return [...rules, ...(preview ? [] : ['', `Sitemap: ${SITE_URL}/sitemap.xml`]), ''].join('\n');
}
