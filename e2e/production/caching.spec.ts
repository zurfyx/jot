import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_HEADS } from '../../src/client/heads';
import { expect, freshNoteId, test } from '../helpers';
import { CLIENT, ORIGIN } from './serve';

/**
 * Caching and load order on the production build (D33): content-hashed assets
 * are cached for a year and never revalidated; everything else, a missing
 * asset's 404 included, is revalidated on every use; the app's script loads
 * at low priority on every page that has it.
 */

test.use({ baseURL: ORIGIN });

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, max-age=0, must-revalidate';

const assets = readdirSync(join(CLIENT, 'assets'));

/**
 * Every file Vite's manifest names: what Vite itself wrote, with its hash in
 * the name, independent of the build's own test for one.
 */
function manifestFiles(): Set<string> {
  const manifest = JSON.parse(readFileSync(`${CLIENT}.manifest.json`, 'utf8')) as Record<
    string,
    { file: string; css?: string[]; assets?: string[] }
  >;
  return new Set(
    Object.values(manifest).flatMap((chunk) => [
      chunk.file,
      ...(chunk.css ?? []),
      ...(chunk.assets ?? []),
    ]),
  );
}

test('every content-hashed asset is cached for a year', async ({ request }) => {
  expect(assets.length).toBeGreaterThan(10);
  // The assets are exactly the files Vite wrote, each named by its content.
  expect(new Set(assets.map((file) => `assets/${file}`))).toEqual(manifestFiles());
  for (const file of assets) {
    const response = await request.get(`/assets/${file}`);
    expect(response.status(), file).toBe(200);
    expect(response.headers()['cache-control'], file).toBe(IMMUTABLE);
  }
});

test('a missing asset is the 404 page, and is not cached', async ({ request }) => {
  for (const path of ['/assets/index-Missing0.js', '/assets/nope.css', '/assets/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers()['cache-control'], path).toBe(REVALIDATE);
  }
});

test('pages and every other file are revalidated on every use', async ({ request }) => {
  for (const path of [
    '/',
    '/docs',
    '/docs/blame',
    '/no/such/page',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/llms-full.txt',
    '/docs.md',
    '/docs/blame.md',
    '/og/index.png',
    '/favicon.svg',
    `/n/${freshNoteId()}`,
    '/new',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBeLessThan(500);
    expect(response.headers()['cache-control'], path).toBe(REVALIDATE);
  }
});

test("the app's script loads at low priority on every page", async ({ request }) => {
  for (const path of [
    '/',
    '/docs',
    '/docs/blame',
    '/no/such/page',
    `/n/${freshNoteId()}`,
    '/new',
  ]) {
    const html = await (await request.get(path)).text();
    const scripts = html.match(/<script type="module"[^>]*>/g) ?? [];
    expect(scripts, path).toHaveLength(1);
    expect(scripts[0], path).toContain('fetchpriority="low"');
  }
  // The built shell carries it too, so nothing serves the app at high priority.
  expect(readFileSync(join(CLIENT, 'n/shell.html'), 'utf8')).toContain('fetchpriority="low"');
});

test('a docs page preloads its own chunks at low priority too', async ({ request }) => {
  for (const head of DOCS_HEADS) {
    const html = await (await request.get(head.path)).text();
    const preloads = html.match(/<link rel="modulepreload"[^>]*>/g) ?? [];
    expect(preloads.length, head.path).toBeGreaterThan(0);
    for (const preload of preloads) {
      expect(preload, head.path).toContain('fetchpriority="low"');
    }
  }
});
