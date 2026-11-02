import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';

import { expect, freshNoteId, test } from '../helpers';
import { ORIGIN } from './serve';

/**
 * Recent notes on the prerendered landing page (D30, D31): the HTML has the
 * section's slot and nothing in it; index.html's head script reserves its
 * rows from the stored list before the first paint; the rows fill in once the
 * page hydrates, in the space already reserved, without a hydration warning.
 */

test.use({ baseURL: ORIGIN });

/** A stored list of `count` notes, written before any page script runs. */
async function seed(context: BrowserContext, count: number): Promise<void> {
  const ids = Array.from({ length: count }, () => freshNoteId());
  await context.addInitScript((list: string[]) => {
    const now = Date.now();
    localStorage.setItem(
      'jot:recent',
      JSON.stringify({
        entries: list.map((id, index) => ({
          id,
          title: `Note ${index + 1}`,
          excerpt: `The text of note ${index + 1}.`,
          openedAt: now - (index + 1) * 60_000,
        })),
        removed: {},
        clearedAt: 0,
      }),
    );
  }, ids);
}

/** The slot's box and the page's height, and where the next section starts. */
function layout(page: Page) {
  return page.evaluate(() => {
    const slot = document.querySelector('[data-recent-slot]')!;
    const box = slot.getBoundingClientRect();
    return {
      top: Math.round(box.top + scrollY),
      height: Math.round(box.height),
      next: Math.round(slot.nextElementSibling!.getBoundingClientRect().top + scrollY),
      page: document.documentElement.scrollHeight,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const count of [3, 8]) {
    test(`${count} recent notes fill their reserved rows as the page hydrates, at ${viewport.width} px`, async ({
      newContext,
    }) => {
      const context = await newContext({ viewport });
      await seed(context, count);
      const page = await context.newPage();
      const found: string[] = [];
      page.on('console', (message: ConsoleMessage) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          found.push(`${message.type()}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => found.push(`pageerror: ${error.message}`));

      // The app's script held back: the prerendered HTML and the head script alone.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(/\/assets\/index-[\w-]+\.js$/, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto('/', { waitUntil: 'commit' });
      const slot = page.locator('[data-recent-slot]');
      await expect(slot).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // The HTML has no rows; the head script has reserved them.
      await expect(page.getByTestId('recent-note')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.hasAttribute('data-recent'))).toBe(
        true,
      );
      const reserved = await layout(page);
      expect(reserved.height).toBeGreaterThan(100);

      release();
      await page.waitForFunction(() => 'hydrated' in document.documentElement.dataset);
      await expect(page.getByTestId('recent-note')).toHaveCount(Math.min(count, 6));
      const hydrated = await layout(page);
      expect(hydrated).toEqual(reserved);
      await page.waitForTimeout(300);
      expect(found).toEqual([]);
    });
  }
}

test('with no recent notes, the slot takes no space', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-recent-slot]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-recent'))).toBe(
    false,
  );
});
