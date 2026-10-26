import { type Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';

/** How far the page can scroll: 0 when everything fits the window. */
function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement!;
    return root.scrollHeight - root.clientHeight;
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`at ${viewport.width}px, ${colorScheme}`, () => {
      test.use({ viewport, colorScheme });

      test('an empty note does not scroll', async ({ page }) => {
        await openNote(page, freshNoteId());
        await expect(page.locator('.note-placeholder')).toBeVisible();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });
    });
  }

  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('an emptied example note, banner and all, does not scroll', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/new?example');
      await expect(page.getByTestId('example-banner')).toBeVisible();
      await expect(editor(page)).toContainText('Team offsite', { timeout: 15_000 });
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await expect(page.locator('.note-placeholder')).toBeVisible();
      await expect(page.getByTestId('example-banner')).toBeVisible();
      await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
    });

    test('a note taller than the window scrolls', async ({ page }) => {
      await openNote(page, freshNoteId());
      await editor(page).click();
      await page.keyboard.type('Long note');
      for (let line = 0; line < 30; line++) {
        await page.keyboard.press('Enter');
        await page.keyboard.type(`Line ${line}`);
      }
      await expect.poll(() => overflow(page)).toBeGreaterThan(0);
    });
  });
}
