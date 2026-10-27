import { type Locator } from '@playwright/test';

import { expect, freshNoteId, openNote, test } from './helpers';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** The computed scrollbar colours and width of an element. */
function scrollbar(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    // Computed as "<thumb> <track>", each an rgb() or rgba() colour.
    const [thumb, track] = style.scrollbarColor.match(/rgba?\([^)]*\)/g) ?? [];
    return { thumb, track, width: style.scrollbarWidth };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test('the page and its menus scroll on a transparent track', async ({ page }) => {
      await openNote(page, freshNoteId());
      const html = await scrollbar(page.locator('html'));
      expect(html.track).toBe(TRANSPARENT);
      expect(html.width).toBe('thin');
      // A thumb in the theme's ink: dark on light, light on dark, translucent.
      expect(html.thumb).toBe(
        colorScheme === 'light' ? 'rgba(20, 22, 26, 0.2)' : 'rgba(236, 238, 241, 0.2)',
      );

      await page.getByRole('button', { name: 'More' }).click();
      expect(await scrollbar(page.getByRole('menu'))).toEqual(html);

      // No ::-webkit-scrollbar rules: they would make macOS overlay scrollbars classic.
      const webkitRules = await page.evaluate(
        () =>
          [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .flatMap((rule) => (rule instanceof CSSGroupingRule ? [...rule.cssRules] : [rule]))
            .filter(
              (rule) =>
                rule instanceof CSSStyleRule && rule.selectorText.includes('-webkit-scrollbar'),
            ).length,
      );
      expect(webkitRules).toBe(0);
    });

    test('the docs nav and code blocks scroll on a transparent track', async ({ page }) => {
      await page.goto('/docs/quick-start');
      const nav = await scrollbar(page.getByTestId('docs-nav'));
      expect(nav.track).toBe(TRANSPARENT);
      expect(nav.thumb).toBe((await scrollbar(page.locator('html'))).thumb);
      const code = await scrollbar(page.getByTestId('docs-code').first().locator('pre'));
      expect(code).toEqual(nav);
    });

    test("the landing page's dark code block has a light thumb", async ({ page }) => {
      await page.goto('/');
      const code = await scrollbar(page.locator('.code-block'));
      expect(code.track).toBe(TRANSPARENT);
      expect(code.thumb).toBe('rgba(231, 233, 238, 0.24)');
    });
  });
}
