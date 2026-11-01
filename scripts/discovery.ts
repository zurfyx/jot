/**
 * What jot tells crawlers and assistants about its public pages (D32), built
 * by scripts/prerender.ts from the same route data as the pages' heads:
 * `sitemap.xml`, `llms.txt` (an index), a Markdown copy of every docs page
 * and `llms-full.txt` (all of them in one file).
 */

export interface SitePage {
  /** As linked: `/`, `/docs`, `/docs/blame`. */
  path: string;
  title: string;
  description: string;
}

export interface DocsEntry extends SitePage {
  group: string;
}

/** Where a page's Markdown copy is served: `/docs` → `/docs.md`, `/docs/blame` → `/docs/blame.md`. */
export function markdownPath(path: string): string {
  if (path === '/' || !path.startsWith('/') || path.endsWith('/')) {
    throw new Error(`discovery: ${path} has no Markdown copy.`);
  }
  return `${path}.md`;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sitemap: every public page's canonical URL. */
export function sitemapXml(urls: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

export interface Site {
  name: string;
  /** The landing page's description: one line on what jot is. */
  summary: string;
  /** An absolute URL for a path. */
  url(path: string): string;
}

/** One line of a Markdown link list. */
const item = (title: string, href: string, description: string) =>
  `- [${title}](${href}): ${description}`;

/**
 * `llms.txt`: the site's name and summary, then every docs page by group,
 * each a link to its Markdown copy with its one line, then the full text.
 */
export function llmsTxt(site: Site, docs: readonly DocsEntry[], groups: readonly string[]): string {
  const sections = groups.map((group) =>
    [
      `## ${group}`,
      '',
      ...docs
        .filter((page) => page.group === group)
        .map((page) => item(page.title, site.url(markdownPath(page.path)), page.description)),
    ].join('\n'),
  );
  return [
    `# ${site.name}`,
    '',
    `> ${site.summary}`,
    '',
    `The app is at ${site.url('/')}. These docs show how it is built on \`@lexical/y\` and Yjs 14; each page below is plain Markdown.`,
    '',
    ...sections.flatMap((section) => [section, '']),
    '## Optional',
    '',
    item('All the docs', site.url('/llms-full.txt'), 'every page above in one file, in order.'),
    '',
  ].join('\n');
}

/** `llms-full.txt`: every docs page's Markdown, in reading order, each under its address. */
export function llmsFullTxt(
  site: Site,
  docs: readonly { page: DocsEntry; markdown: string }[],
): string {
  return [
    `# ${site.name}`,
    '',
    `> ${site.summary}`,
    '',
    ...docs.flatMap(({ page, markdown }) => [
      '---',
      '',
      `Source: ${site.url(page.path)}`,
      '',
      markdown.trimEnd(),
      '',
    ]),
  ].join('\n');
}
