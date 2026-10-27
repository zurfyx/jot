import type { Locator, Page } from '@playwright/test';

import { expect, rest, shoot, shootElement, test } from './setup';

/**
 * The landing page, under reduced motion: its loops (the fan's sway, the
 * example card's typing, the two windows' story) rest on their final states,
 * the same in every run. motion.spec.ts covers the motion itself.
 */
async function openLanding(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await rest(page);
}

function hero(page: Page) {
  return page.getByRole('region', { name: 'Just start typing.' });
}

test('the hero at rest', async ({ page }) => {
  await openLanding(page);
  await shoot(page, 'landing-hero');
});

/** Which card link the pointer is over, if any, and whether it is over the fan. */
function hovered(page: Page) {
  return page.evaluate(() => {
    const element = [...document.querySelectorAll(':hover')].at(-1);
    const card = element?.closest('[data-testid="new-note-card"], [data-testid="example-card"]');
    return {
      card: card?.getAttribute('data-testid') ?? null,
      inFan: card ? 'card' : element?.closest('[data-fan-cards]') ? 'fan' : 'outside',
    };
  });
}

/**
 * The fan's cards overlap and lean, and hovering changes where they sit:
 * hovers the first point of a grid over `area` that lands on `card` (a card
 * link's test id, or null for the fan alone) once the fan has moved.
 */
async function hoverFan(page: Page, card: string | null, area: Locator) {
  const box = (await area.boundingBox())!;
  for (let row = 1; row < 8; row++) {
    for (let column = 1; column < 8; column++) {
      // From the fan at rest, not from a card another hover moved.
      await rest(page);
      await page.mouse.move(box.x + (box.width * column) / 8, box.y + (box.height * row) / 8);
      // Hover follows the pointer after the next frame: give it a moment.
      await page.waitForTimeout(50);
      const now = await hovered(page);
      if (now.inFan !== 'outside' && now.card === card) {
        return;
      }
    }
  }
  throw new Error(`No point hovers ${card ?? 'the fan alone'}.`);
}

test('the hero fan, hovered and lifted', async ({ page }) => {
  await openLanding(page);
  const shots: Buffer[] = [];
  const state = async (name: string) => {
    await shootElement(hero(page), name);
    shots.push(await hero(page).screenshot({ animations: 'disabled', caret: 'hide' }));
  };
  // Hovering the fan (the recipe card is not a link) spreads it.
  await hoverFan(page, null, page.locator('[data-fan-recipe]'));
  await state('landing-fan-hovered');
  // Hovering a card lifts it and shows Open.
  await hoverFan(page, 'new-note-card', page.getByTestId('new-note-card'));
  await state('landing-fan-new-lifted');
  await hoverFan(page, 'example-card', page.getByTestId('example-card'));
  await state('landing-fan-example-lifted');
  // Three different states, not one picture three times.
  expect(shots[0]!.equals(shots[1]!)).toBe(false);
  expect(shots[1]!.equals(shots[2]!)).toBe(false);
  expect(shots[0]!.equals(shots[2]!)).toBe(false);
});

test('the two windows, at the end of the story', async ({ page }) => {
  await openLanding(page);
  const section = page.getByRole('region', { name: 'Start a note. Share it. Type together.' });
  await section.scrollIntoViewIfNeeded();
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

test('the whole page', async ({ page }) => {
  await openLanding(page);
  await expect(page.getByTestId('example-card')).toContainText('Send the agenda');
  await shoot(page, 'landing-whole', { fullPage: true });
});
