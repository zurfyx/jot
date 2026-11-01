import type { ConsoleMessage, Page } from '@playwright/test';

import { DOCS_HEADS, PAGE_HEADS } from '../../src/client/heads';
import { siteUrl } from '../../src/client/site';
import { expect, freshNoteId, test } from '../helpers';
import { ORIGIN } from './serve';

/**
 * The prerendered pages and the Worker's answers, on the production build in
 * wrangler dev (D31): every public page is HTML with its real content and
 * head, hydrates without a mismatch, and every path gets its real status.
 */

test.use({ baseURL: ORIGIN });

/** The text inside `#root`, tags dropped. */
function rootText(html: string): string {
  const start = html.indexOf('<div id="root">');
  const end = html.indexOf('</body>');
  return html
    .slice(start, end)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

for (const head of PAGE_HEADS) {
  test(`${head.path} is prerendered with its content and head`, async ({ request }) => {
    const response = await request.get(head.path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    expect(html).toContain(`<title>${attr(head.title)}</title>`);
    expect(html).toContain(`<meta name="description" content="${attr(head.description)}" />`);
    expect(html).toContain(`<link rel="canonical" href="${siteUrl(head.path)}" />`);
    for (const [property, value] of [
      ['og:title', head.title],
      ['og:description', head.description],
      ['og:url', siteUrl(head.path)],
      ['og:image', siteUrl(head.image)],
      ['og:type', head.type],
      ['og:site_name', 'jot'],
    ]) {
      expect(html, property).toContain(`<meta property="${property}" content="${attr(value!)}" />`);
    }
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    const structured = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(structured!)).toMatchObject({
      '@type': head.path === '/' ? 'WebSite' : 'TechArticle',
      url: siteUrl(head.path),
    });
    expect(html).toMatch(
      /<link rel="preload" href="\/assets\/geist-latin-wght-normal-[\w-]+\.woff2"/,
    );
    // The page's own text is in the HTML, not an empty root.
    const text = rootText(html);
    expect(text.length).toBeGreaterThan(1000);
    const heading = head.path === '/' ? 'Just start typing.' : head.card.heading;
    expect(text).toContain(heading);
    // Its preview image is served.
    const image = await request.get(head.image);
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toBe('image/png');
  });
}

test('the landing page is in the HTML, buttons, links and all', async ({ request }) => {
  const text = rootText(await (await request.get('/')).text());
  for (const words of ['Start a new note', 'See the example', 'Live cursors', 'Questions']) {
    expect(text).toContain(words);
  }
  const html = await (await request.get('/')).text();
  // Every link that opens a new note is a real link, and no crawler follows it.
  const starts = [...html.matchAll(/<a\b[^>]*href="\/new(?:\?example)?"[^>]*>/g)].map(
    ([tag]) => tag,
  );
  expect(starts.length).toBe(7);
  for (const tag of starts) {
    expect(tag).toContain('rel="nofollow"');
  }
});

/** Console errors and warnings, and uncaught errors, from `page`. */
function problems(page: Page): string[] {
  const found: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      found.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => found.push(`pageerror: ${error.message}`));
  return found;
}

for (const [colorScheme, reducedMotion] of [
  ['light', 'no-preference'],
  ['dark', 'reduce'],
] as const) {
  test(`the prerendered pages hydrate without a mismatch (${colorScheme}, ${reducedMotion} motion)`, async ({
    newContext,
  }) => {
    const context = await newContext({ colorScheme, reducedMotion });
    for (const path of PAGE_HEADS.map((head) => head.path)) {
      const page = await context.newPage();
      const found = problems(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      // React reports a mismatch as a recoverable error once it has hydrated.
      await page.waitForTimeout(300);
      expect(found, path).toEqual([]);
      await page.close();
    }
  });
}

test('the 404 page hydrates without a mismatch, for any path and an unknown docs page', async ({
  page,
}) => {
  const found = problems(page);
  for (const path of ['/no/such/page', '/docs/nope']) {
    found.length = 0;
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page doesn't exist.");
    await page.waitForTimeout(300);
    // The page's own 404 is a console error; nothing else may be.
    expect(
      found.filter((line) => !/status of 404/.test(line)),
      path,
    ).toEqual([]);
  }
});

test('every path gets its real status', async ({ request }) => {
  const NOINDEX = 'noindex, nofollow';
  const note = freshNoteId();
  const cases: [string, number, string | null][] = [
    ['/', 200, null],
    ...DOCS_HEADS.map((head): [string, number, string | null] => [head.path, 200, null]),
    ['/docs/nope', 404, null],
    ['/no/such/page', 404, null],
    ['/new', 200, null],
    ['/new?example', 200, null],
    [`/n/${note}`, 200, NOINDEX],
    ['/n/nope', 400, NOINDEX],
    ['/n/public', 400, NOINDEX],
    // The note page's shell sits under /n/, where asking for it is a malformed link.
    ['/n/shell', 400, NOINDEX],
    ['/api/elsewhere', 404, NOINDEX],
    ['/robots.txt', 200, null],
  ];
  for (const [path, status, robots] of cases) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(status);
    expect(response.headers()['x-robots-tag'] ?? null, path).toBe(robots);
  }
  // A trailing slash redirects to the page's own address.
  for (const path of ['/docs/', '/docs/blame/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toBe(path.slice(0, -1));
  }
  // The 404 page is no page to index; a note's shell is the empty document.
  expect(await (await request.get('/no/such/page')).text()).toContain(
    '<meta name="robots" content="noindex" />',
  );
  expect(rootText(await (await request.get(`/n/${note}`)).text())).toBe('');
});

test('/new and /new?example open a fresh note in the browser', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/new');
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/);
  await page.goto('/new?example');
  await expect(page.getByTestId('example-banner')).toBeVisible();
});
