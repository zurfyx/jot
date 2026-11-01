import type { Page } from '@playwright/test';

import { expect, test } from '../helpers';
import { entryScript, navigateInApp, ORIGIN, serveBuild } from './serve';

/**
 * The production build in a browser (D28, D31): the theme before the first
 * paint, prerendered pages included, lazy stylesheets that arrive late, and
 * stylesheets that load in any order.
 */

test.use({ baseURL: ORIGIN });

for (const [scheme, background, landing] of [
  ['dark', 'rgb(18, 19, 22)', 'rgb(13, 16, 32)'],
  ['light', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)'],
] as const) {
  test(`the ${scheme} theme is on the page before any script runs`, async ({ newContext }) => {
    const context = await newContext({ colorScheme: scheme });
    const page = await context.newPage();
    const entry = entryScript();
    const server = await serveBuild(page, { hold: new RegExp(`/${entry}$`) });
    await page.goto('/', { waitUntil: 'commit' });
    // The stylesheet is in, the app's script is not: index.html's inline
    // script has set data-theme, and the CSS alone paints the page, the
    // prerendered landing page in its own colours ("Night" in dark).
    await expect
      .poll(() =>
        page.evaluate(() => document.body && getComputedStyle(document.body).backgroundColor),
      )
      .toBe(background);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
    const prerendered = page.locator('[data-scope="landing"]');
    await expect(prerendered.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(prerendered).toHaveCSS('background-color', landing);
    expect(await page.evaluate(() => 'hydrated' in document.documentElement.dataset)).toBe(false);
    server.release();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.close();
  });
}

test('a lazy page waits for its own stylesheet, however late it arrives', async ({ page }) => {
  await serveBuild(page, { delays: [[/\/assets\/DocsPage-[\w-]+\.css$/, 1500]] });
  // Records, at the moment the docs' heading is first in the document,
  // whether their stylesheet had loaded. Reached from the landing page, the
  // docs are a lazy chunk; opened directly, their prerendered page links the
  // stylesheet in its head, which holds the first paint.
  await page.goto('/');
  await page.evaluate(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector('[data-testid="docs-main"] h1') !== null) {
        observer.disconnect();
        (window as unknown as { __docsSheet: boolean }).__docsSheet = [
          ...document.styleSheets,
        ].some((sheet) => /DocsPage-[\w-]+\.css$/.test(sheet.href ?? ''));
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await navigateInApp(page, '/docs');
  await expect(page.getByTestId('docs-main').getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __docsSheet: boolean }).__docsSheet),
  ).toBe(true);
});

const PROPERTIES = [
  'display',
  'position',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-color',
  'border-radius',
  'box-shadow',
  'opacity',
  'width',
  'height',
  'gap',
  'grid-template-columns',
  'text-decoration-line',
  'cursor',
];

/** Every element's computed style, in document order. */
function fingerprint(page: Page): Promise<string[]> {
  return page.evaluate((properties) => {
    return [...document.querySelectorAll('#root *')].map((element) => {
      const style = getComputedStyle(element);
      return `${element.tagName} ${properties.map((p) => style.getPropertyValue(p)).join('|')}`;
    });
  }, PROPERTIES);
}

async function settled(page: Page, ready: string) {
  await expect(page.locator(ready).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

const NOTE = '/n/AAAAAAAAAAAAAAAAAAAAAA';
const PAGES = {
  docs: { path: '/docs/content-in-yjs', ready: '[data-testid="inspector-tree"] li' },
  note: { path: NOTE, ready: '[data-testid="dock"]' },
} as const;

for (const [name, target] of Object.entries(PAGES)) {
  for (const before of ['/', name === 'docs' ? NOTE : '/docs']) {
    test(`the ${name} page looks the same reached from ${before} as opened directly`, async ({
      newContext,
    }) => {
      const open = async () => {
        const context = await newContext({ reducedMotion: 'reduce' });
        const page = await context.newPage();
        await serveBuild(page);
        return { context, page };
      };
      const direct = await open();
      await direct.page.goto(target.path);
      await settled(direct.page, target.ready);
      const expected = await fingerprint(direct.page);
      await direct.context.close();

      // The other page's stylesheets load first; this page's arrive after them.
      const via = await open();
      await via.page.goto(before);
      await settled(
        via.page,
        before === '/' ? 'h1' : before === NOTE ? '[data-testid="dock"]' : 'h1',
      );
      await navigateInApp(via.page, target.path);
      await settled(via.page, target.ready);
      expect(await fingerprint(via.page)).toEqual(expected);
      await via.context.close();
    });
  }
}
