import type { Locator, Page } from '@playwright/test';

import { FIXED_TIME, expect, rest, shoot, shootElement, test } from './setup';

/**
 * The landing page. Its timers (the example card's typing, the two-windows
 * story) run on a paused clock, so each shot is taken at a chosen moment.
 */
async function openLanding(page: Page) {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await rest(page);
}

function hero(page: Page) {
  return page.getByRole('region', { name: 'Just start typing.' });
}

/**
 * The fan's cards sway, so they are never "stable" for Playwright's hover:
 * move the mouse to a corner of the card instead, one the card in front
 * doesn't cover.
 */
async function hoverCard(page: Page, card: Locator, corner: 'left' | 'right' = 'left') {
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const x = corner === 'left' ? box!.x + 40 : box!.x + box!.width - 40;
  await page.mouse.move(x, box!.y + 40);
}

test('the hero at rest', async ({ page }) => {
  await openLanding(page);
  await shoot(page, 'landing-hero');
});

test('the hero fan, hovered and lifted', async ({ page }) => {
  // The cards sway, so a card under a still pointer can slip out from under
  // it between two shots. Reduced motion stops the sway and shows each hover's
  // end state at once (the motion spec covers the lift itself).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLanding(page);
  // Hovering the fan (the recipe card is not a link) spreads it.
  await hoverCard(page, page.getByText("Grandma's pancakes", { exact: true }));
  await shootElement(hero(page), 'landing-fan-hovered');
  // Hovering a card lifts it and shows Open.
  await hoverCard(page, page.getByTestId('new-note-card'));
  await shootElement(hero(page), 'landing-fan-new-lifted');
  await hoverCard(page, page.getByTestId('example-card'), 'right');
  await shootElement(hero(page), 'landing-fan-example-lifted');
});

test('the two windows, at the end of the story', async ({ page }) => {
  await openLanding(page);
  const section = page.getByRole('region', { name: 'Start a note. Share it. Type together.' });
  await section.scrollIntoViewIfNeeded();
  await page.clock.runFor(5000);
  await expect(page.getByTestId('how-steps').getByRole('listitem').nth(2)).toHaveClass(/is-on/);
  await shootElement(section, 'landing-two-windows');
});

for (const [index, title] of [
  'Live cursors',
  'Blame',
  'Offline, then merge',
  'AI as a collaborator',
].entries()) {
  test(`the feature tab ${title}`, async ({ page }) => {
    await openLanding(page);
    const section = page.getByRole('region', { name: 'Lexical with Yjs 14, up close.' });
    const tab = section.getByRole('tab', { name: new RegExp(`^${title}`) });
    await tab.click();
    await rest(page);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await shootElement(section, `landing-feature-${index + 1}`);
  });
}

test('the sections below: developers, questions, the ending and the footer', async ({ page }) => {
  await openLanding(page);
  await shootElement(
    page.getByRole('region', { name: 'Read the code that matters.' }),
    'landing-developers',
  );
  await shootElement(page.getByRole('region', { name: 'Questions' }), 'landing-questions');
  await shootElement(
    page.getByRole('region', { name: 'Try it, then see how it works.' }),
    'landing-ending',
  );
  await shootElement(page.getByRole('contentinfo'), 'landing-footer');
});

test('the whole page, under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await rest(page);
  await expect(page.getByTestId('example-card')).toContainText('Send the agenda');
  await shoot(page, 'landing-reduced-motion', { fullPage: true });
});
