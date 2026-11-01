import type { ConsoleMessage, Page } from '@playwright/test';

import { DOCS_HEADS, PAGE_HEADS } from '../../src/client/heads';
import { siteUrl } from '../../src/client/site';
import { expect, freshNoteId, test } from '../helpers';
import { navigateInApp, ORIGIN } from './serve';

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
    // The 404 page's own file is no page either.
    ['/404', 404, null],
    ['/404.html', 404, null],
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

for (const injected of [false, true]) {
  test(`hydration waits for the docs' own chunk, however late it arrives${injected ? ', and a mismatch in it is caught' : ''}`, async ({
    page,
  }) => {
    const found = problems(page);
    await page.route(/\/assets\/DocsPage-[\w-]+\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    if (injected) {
      // The HTML says something the browser's first render won't.
      await page.route(
        (url) => url.pathname === '/docs/blame',
        async (route) => {
          const response = await route.fetch();
          const html = await response.text();
          expect(html).toContain('>Blame and history</h1>');
          const body = html.replace('>Blame and history</h1>', '>Blame and histories</h1>');
          await route.fulfill({ response, body });
        },
      );
    }
    // goto waits for `data-hydrated`, which the docs' page sets once it has hydrated.
    await page.goto('/docs/blame');
    await page.waitForTimeout(300);
    if (injected) {
      expect(found.join('\n')).toMatch(/#418|hydrat/i);
    } else {
      expect(found).toEqual([]);
    }
  });
}

/** What a page's head tells search engines and link previews. */
function headOf(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    meta: [
      ...document.querySelectorAll(
        'meta[property^="og:"], meta[name^="twitter:"], meta[name="robots"]',
      ),
    ]
      .map(
        (meta) =>
          `${meta.getAttribute('property') ?? meta.getAttribute('name')}=${meta.getAttribute('content')}`,
      )
      .sort(),
    structured: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => JSON.parse(script.textContent ?? '') as unknown,
    ),
  }));
}

test('moving between docs pages in the app brings the whole head with each page', async ({
  page,
}) => {
  await page.goto('/docs/ai');
  const ai = await headOf(page);
  expect(ai.canonical).toBe(siteUrl('/docs/ai'));
  await page.goto('/docs/blame');
  await page
    .getByTestId('docs-nav')
    .getByRole('link', { name: 'AI as a collaborator', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/ai$/);
  await expect(page).toHaveTitle('AI as a collaborator · jot docs');
  expect(await headOf(page)).toEqual(ai);

  // A docs page that doesn't exist has the 404 page's head, and back again.
  await navigateInApp(page, '/docs/nope');
  await expect(page).toHaveTitle('Page not found · jot');
  const missing = await headOf(page);
  expect(missing.canonical).toBeNull();
  expect(missing.meta).toEqual(['robots=noindex']);
  expect(missing.structured).toEqual([]);
  await page.goBack();
  await expect(page).toHaveTitle('AI as a collaborator · jot docs');
  expect(await headOf(page)).toEqual(ai);
});

test("with scripts off, a note's page says notes need JavaScript, with a link home", async ({
  newContext,
}) => {
  const context = await newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  for (const path of ['/new', '/new?example', `/n/${freshNoteId()}`]) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveText(
      'jot needs JavaScript to edit notes.',
    );
  }
  await page.getByRole('link', { name: 'Go to jot' }).click();
  await page.waitForURL(`${ORIGIN}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
});

test('with scripts on, a note page shows no notice', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(`/n/${freshNoteId()}`);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByText('jot needs JavaScript to edit notes.')).toBeHidden();
});

test('a note has none of the public tags, and the landing page gets its head back', async ({
  page,
}) => {
  await page.goto('/');
  const landing = await headOf(page);
  expect(landing.canonical).toBe(siteUrl('/'));
  await page
    .getByRole('link', { name: /^Start a new note/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(async () => (await headOf(page)).canonical).toBeNull();
  const note = await headOf(page);
  expect(note.meta).toEqual([]);
  expect(note.structured).toEqual([]);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
  await expect.poll(() => headOf(page)).toEqual(landing);
});

/**
 * Records when the page first reports an error (React reports a mismatch as a
 * recoverable error) and when <html> first gets `data-hydrated`.
 */
async function recordTimes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const times = { error: -1, message: '', hydrated: -1 };
    (window as unknown as { __times: typeof times }).__times = times;
    const error = (message: string) => {
      if (times.error < 0) {
        times.error = performance.now();
        times.message = message;
      }
    };
    addEventListener('error', (event) => error(String(event.message)));
    const log = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      error(args.map(String).join(' '));
      log(...args);
    };
    // <html> may not exist yet: watch the whole document for the attribute.
    new MutationObserver(() => {
      if (times.hydrated < 0 && document.documentElement?.dataset.hydrated !== undefined) {
        times.hydrated = performance.now();
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-hydrated'] });
  });
}

for (const [path, from, to] of [
  ['/', 'Just start <br/>', 'Just begin <br/>'],
  ['/docs/blame', '>Blame and history</h1>', '>Blame and histories</h1>'],
  ['/no/such/page', '>404</p>', '>405</p>'],
  ['/docs/nope', '>404</p>', '>405</p>'],
] as const) {
  test(`${path} is marked hydrated only after React has checked all of it, on a slow CPU`, async ({
    page,
  }) => {
    // A page eight times slower, as a low-end phone: hydration takes long.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    await recordTimes(page);
    // The HTML says something the browser's first render won't.
    await page.route(
      (url) => url.pathname === path,
      async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        expect(html).toContain(from);
        await route.fulfill({ response, body: html.replace(from, to) });
      },
    );
    await page.goto(path);
    const times = await page.evaluate(
      () =>
        (window as unknown as { __times: { error: number; message: string; hydrated: number } })
          .__times,
    );
    expect(times.message, 'the mismatch is reported').toMatch(/#418|hydrat/i);
    expect(times.error, 'before the page is marked hydrated').toBeLessThanOrEqual(times.hydrated);
  });
}

/** Holds the head module back until `release()`. */
async function holdHeadModule(page: Page): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/head-[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test('a head that arrives after the page moved on is dropped', async ({ page }) => {
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/');
  const landing = await headOf(page);
  await page
    .getByRole('link', { name: /^Start a new note/ })
    .first()
    .click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const release = await holdHeadModule(page);
  // Home again: its title at once, the rest of its head still loading...
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
  await expect(page).toHaveTitle('jot · Just start typing');
  // ...when the app moves on to the note again.
  await page.goForward();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect.poll(() => page.title()).toContain('· jot');
  const note = await headOf(page);
  release();
  await page.waitForTimeout(1000);
  // The landing page's head arrived late, and was dropped.
  expect(await headOf(page)).toEqual(note);
  expect(note.canonical).toBeNull();
  // Back home, the head is whole.
  await page.goBack();
  await expect.poll(() => headOf(page)).toEqual(landing);
});

test('offline, the app keeps a sensible head and tries again when back online', async ({
  page,
  context,
}) => {
  const found = problems(page);
  await page.routeWebSocket(/.*/, () => {});
  await page.goto('/');
  const landing = await headOf(page);
  const start = page.getByRole('link', { name: /^Start a new note/ }).first();
  // The editor's chunk loads on intent, before the network goes.
  await start.hover();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await start.click();
  await expect(page.getByTestId('editor')).toBeVisible();
  // The note has none of the landing page's tags, without the head module.
  const note = await headOf(page);
  expect(note.canonical).toBeNull();
  expect(note.meta).toEqual([]);
  expect(note.structured).toEqual([]);
  // Home, still offline: the head module can't load, but the title is right.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
  await expect(page).toHaveTitle('jot · Just start typing');
  await page.waitForTimeout(500);
  // Back online, the next move home brings the whole head.
  await context.setOffline(false);
  await page.goForward();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.goBack();
  await expect.poll(() => headOf(page)).toEqual(landing);
  // Nothing went uncaught (an offline note logs its failed socket; nothing else).
  expect(found.filter((line) => line.startsWith('pageerror'))).toEqual([]);
});
