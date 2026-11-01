import { describe, expect, it } from 'vitest';

import { DOCS_GROUPS, DOCS_PAGES, docsPath } from '../src/client/docs/pages';
import { PAGE_HEADS } from '../src/client/heads';
import { siteUrl } from '../src/client/site';
import { llmsFullTxt, llmsTxt, markdownPath, sitemapXml } from './discovery';

/** The sitemap and llms.txt (D32), from the route data. */

const site = { name: 'jot', summary: 'A note anyone can edit.', url: siteUrl };
const docs = DOCS_PAGES.map((page) => ({
  path: docsPath(page.slug),
  title: page.title,
  description: page.blurb,
  group: page.group,
}));

describe('the discovery files', () => {
  it('give each docs page a Markdown address next to its own', () => {
    expect(markdownPath('/docs')).toBe('/docs.md');
    expect(markdownPath('/docs/blame')).toBe('/docs/blame.md');
    expect(() => markdownPath('/')).toThrow();
    expect(() => markdownPath('/docs/')).toThrow();
  });

  it('list every public page in the sitemap, by its canonical URL', () => {
    const xml = sitemapXml(PAGE_HEADS.map((head) => siteUrl(head.path)));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns=')).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
    expect(locs).toEqual(PAGE_HEADS.map((head) => siteUrl(head.path)));
    expect(sitemapXml(['https://x.dev/?a=1&b=2'])).toContain(
      '<loc>https://x.dev/?a=1&amp;b=2</loc>',
    );
  });

  it('index every docs page in llms.txt, under its group, in reading order', () => {
    const text = llmsTxt(site, docs, DOCS_GROUPS);
    expect(text.startsWith('# jot\n\n> A note anyone can edit.\n')).toBe(true);
    expect(text).toContain(siteUrl('/'));
    const links = [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)];
    expect(links.map(([, , href]) => href)).toEqual([
      ...docs.map((page) => siteUrl(markdownPath(page.path))),
      siteUrl('/llms-full.txt'),
    ]);
    for (const page of docs) {
      expect(text).toContain(
        `- [${page.title}](${siteUrl(markdownPath(page.path))}): ${page.description}`,
      );
    }
    const headings = [...text.matchAll(/^## (.+)$/gm)].map(([, heading]) => heading);
    expect(headings).toEqual([...DOCS_GROUPS, 'Optional']);
  });

  it('put every page in llms-full.txt, in order, under its address', () => {
    const text = llmsFullTxt(
      site,
      docs.map((page) => ({ page, markdown: `# ${page.title}\n\nBody.\n` })),
    );
    let at = 0;
    for (const page of docs) {
      const next = text.indexOf(`Source: ${siteUrl(page.path)}\n\n# ${page.title}`, at);
      expect(next, page.path).toBeGreaterThan(at);
      at = next;
    }
  });
});
