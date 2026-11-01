import { writeFileSync } from 'node:fs';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { DOCS_HEADS } from '../../src/client/heads';
import { expect, test } from '../helpers';
import { ORIGIN } from './serve';

/**
 * No jump on load (D31): each prerendered page looks the same with scripts
 * off as right after it hydrates, in light and dark, at 1440 and 390 px, and
 * the landing page under reduced motion too, where its illustrations rest on
 * their end from the first paint (landing/MotionFrames.tsx).
 *
 * What only exists with scripts is left out on purpose:
 * - time: the hydrated page's clock is held, so the landing page's
 *   animations (the fan's typing, the two windows, the feature tabs) stay on
 *   the opening frame both pages show;
 * - the live inspector (How content lives in Yjs): its chunk is held, so its
 *   loading frame stays, as it is without scripts;
 * - the start shortcut's label on Apple platforms, which index.html's script
 *   picks: the hydrated page reports a platform that is not Apple's.
 * Without scripts, the dark theme follows the system (the prerendered head's
 * <noscript> style), as the pre-paint script does with them.
 */

test.use({ baseURL: ORIGIN });

const PAGES = ['/', ...DOCS_HEADS.map((head) => head.path)];

type ContextOptions = Parameters<Browser['newContext']>[0];

/**
 * CSS motion off, in both pages, from the first byte: Playwright's own
 * `animations: 'disabled'` ends finite animations, and the feature tabs
 * advance when their progress line's animation ends.
 */
const STILL =
  '<style>*, *::before, *::after { animation: none !important; transition: none !important; }</style>';

/** The whole page, captured at its own height (see e2e/visual/setup.ts, shootTall). */
async function capture(page: Page): Promise<Buffer> {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('16px "Geist Variable"'),
      document.fonts.load('16px "Geist Mono Variable"'),
    ]);
    await document.fonts.ready;
  });
  const size = page.viewportSize()!;
  let height = size.height;
  for (let i = 0; i < 5; i++) {
    const next = await page.evaluate(() => document.documentElement.scrollHeight);
    if (next === height) {
      break;
    }
    height = next;
    await page.setViewportSize({ width: size.width, height });
  }
  return page.screenshot({ caret: 'hide' });
}

async function open(
  newContext: (options?: ContextOptions) => Promise<BrowserContext>,
  options: ContextOptions,
  scripts: boolean,
  path: string,
): Promise<Buffer> {
  const context = await newContext({ ...options, javaScriptEnabled: scripts });
  const page = await context.newPage();
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace('</head>', `${STILL}</head>`);
      await route.fulfill({ response, body });
    },
  );
  if (scripts) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date('2026-11-01T12:00:00Z'));
    await page.route(/\/assets\/Inspector-[\w-]+\.js$/, () => {
      // Held: the inspector's frame stays as it is without scripts.
    });
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(path);
  } else {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
  }
  const shot = await capture(page);
  await context.close();
  return shot;
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    for (const [reducedMotion, paths] of [
      ['no-preference', PAGES],
      ['reduce', ['/']],
    ] as const) {
      const motion = reducedMotion === 'reduce' ? ', reduced motion' : '';
      test(`the prerendered pages don't move as they hydrate (${colorScheme}, ${viewport.width} px${motion})`, async ({
        newContext,
      }, testInfo) => {
        test.setTimeout(120_000);
        const options: ContextOptions = {
          colorScheme,
          viewport,
          reducedMotion,
          deviceScaleFactor: 1,
        };
        for (const path of paths) {
          const without = await open(newContext, options, false, path);
          const hydrated = await open(newContext, options, true, path);
          if (!without.equals(hydrated)) {
            // Both pictures, side by side in test-results/, to see what moved.
            const name = path.replace(/\W+/g, '-');
            writeFileSync(testInfo.outputPath(`${name}-without-scripts.png`), without);
            writeFileSync(testInfo.outputPath(`${name}-hydrated.png`), hydrated);
          }
          expect(without.equals(hydrated), `${path} moved as it hydrated`).toBe(true);
        }
      });
    }
  }
}
