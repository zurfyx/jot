import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_PAGES, docsPath } from '../../src/client/docs/pages';
import { headTags } from '../../src/client/head';
import { PAGE_HEADS } from '../../src/client/heads';
import { SITE_URL, siteUrl } from '../../src/client/site';
import { markdownPath } from '../../scripts/discovery';
import { expect, test } from '../helpers';
import { CLIENT, ORIGIN } from './serve';

/**
 * The guard on what crawlers and assistants read (D32), on the production
 * build: every public page is in the sitemap and in llms.txt, every docs page
 * has its Markdown copy, everything is served with its type and reads as
 * what it says it is, and every address is a canonical one. They are static
 * files, so every host serves the same ones, a Preview included: what is
 * served here is the built file.
 */

test.use({ baseURL: ORIGIN });

/**
 * Bold text glued to the word after it (`**Worker**routes`), where the page
 * separates the two with CSS but the Markdown runs them together. Code is
 * left out: a `**` there is code.
 */
function gluedBold(markdown: string): string[] {
  const prose = markdown
    .replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, '')
    .replace(/(`+)[\s\S]*?\1/g, '');
  // Each bold span, paired from the left, then what follows it.
  return [...prose.matchAll(/\*\*(?:\\.|[^*\\\n])+?\*\*/g)]
    .filter((match) => /[\p{L}\p{N}]/u.test(prose.charAt(match.index + match[0].length)))
    .map(([bold]) => bold);
}

/** A production URL, fetched from the build under test. */
const local = (url: string) => url.replace(SITE_URL, ORIGIN);

test('robots.txt keeps notes and new notes out, and names the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
  const text = await response.text();
  // The built file itself, as every host serves it.
  expect(text).toBe(readFileSync(join(CLIENT, 'robots.txt'), 'utf8'));
  const lines = text.split('\n');
  for (const line of [
    'User-agent: *',
    'Disallow: /n/',
    'Disallow: /api/',
    'Disallow: /new',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ]) {
    expect(lines).toContain(line);
  }
});

test('the sitemap is well formed and lists every public page by its canonical URL', async ({
  request,
  page,
}) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/xml; charset=utf-8');
  const xml = await response.text();
  expect(xml).toBe(readFileSync(join(CLIENT, 'sitemap.xml'), 'utf8'));
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    return {
      error: document.querySelector('parsererror')?.textContent ?? null,
      namespace: document.documentElement.namespaceURI,
      root: document.documentElement.localName,
      locs: [...document.getElementsByTagName('loc')].map((loc) => loc.textContent),
    };
  }, xml);
  expect(parsed.error).toBeNull();
  expect(parsed.root).toBe('urlset');
  expect(parsed.namespace).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
  expect(parsed.locs).toEqual(PAGE_HEADS.map((head) => headTags(head).canonical));
  // Each address is the page's own canonical, and the page is there.
  for (const loc of parsed.locs) {
    const html = await (await request.get(local(loc!))).text();
    expect(html, loc!).toContain(`<link rel="canonical" href="${loc}" />`);
  }
});

test('llms.txt indexes every page, and every link in it is served', async ({ request }) => {
  const response = await request.get('/llms.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
  const text = await response.text();
  expect(text.startsWith('# jot\n\n> ')).toBe(true);
  // The landing page is the index's own subject; every docs page has a line.
  expect(text).toContain(siteUrl('/'));
  for (const docs of DOCS_PAGES) {
    expect(text).toContain(
      `- [${docs.title}](${siteUrl(markdownPath(docsPath(docs.slug)))}): ${docs.blurb}`,
    );
  }
  const links = [...text.matchAll(/\]\((https:[^)]+)\)/g)].map(([, href]) => href!);
  expect(links.length).toBe(DOCS_PAGES.length + 1);
  for (const href of links) {
    const linked = await request.get(local(href));
    expect(linked.status(), href).toBe(200);
  }
});

test('the glued-bold check finds a label run into the next word, and only that', () => {
  expect(gluedBold('**Worker**routes and **You** a browser')).toEqual(['**Worker**']);
  expect(gluedBold('a **line**; a **format**. `**x**y` and **1 · Who**A')).toEqual(['**1 · Who**']);
  expect(gluedBold('```ts\nconst a = **b**c;\n```\n')).toEqual([]);
});

test('every docs page has its Markdown copy, converted from the page', async ({ request }) => {
  const full = await request.get('/llms-full.txt');
  expect(full.headers()['content-type']).toBe('text/plain; charset=utf-8');
  const fullText = await full.text();
  for (const docs of DOCS_PAGES) {
    const path = docsPath(docs.slug);
    const response = await request.get(markdownPath(path));
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toBe('text/markdown; charset=utf-8');
    const markdown = await response.text();
    // The page's own heading, its text and no markup.
    const heading = docs.slug === '' ? 'Learn collaborative Lexical' : docs.title;
    expect(markdown, path).toContain(`\n# ${heading}\n`);
    expect(markdown, path).not.toMatch(/<\/?(div|span|p|a|b|code|pre)\b/);
    expect(markdown.length, path).toBeGreaterThan(800);
    // And it is in the full text, under its address.
    expect(fullText, path).toContain(`Source: ${siteUrl(path)}\n\n${markdown.trimEnd()}`);
  }
  // No bold label runs into the word after it, in any page or in the full text.
  for (const docs of DOCS_PAGES) {
    const path = markdownPath(docsPath(docs.slug));
    expect(gluedBold(await (await request.get(path)).text()), path).toEqual([]);
  }
  expect(gluedBold(fullText), '/llms-full.txt').toEqual([]);
  // Code keeps its language.
  const quickStart = await (await request.get('/docs/quick-start.md')).text();
  expect(quickStart).toContain('```ts\nimport {');
  expect(quickStart).toContain('```sh\npnpm add');
});

test('an unknown Markdown page is the 404 page, as HTML', async ({ request }) => {
  const response = await request.get('/docs/nope.md');
  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toBe('text/html; charset=utf-8');
});
