import type { Page } from '@playwright/test';

import { editor, expect, test } from './helpers';

/** The example: the offsite plan, then the demo's edits (D20). */
const TITLE = 'Team offsite, May 14';
const SEEDED = [TITLE, 'Book the room', 'Order lunch', 'Gerard'];
const PLAYED = [
  'Send the agenda',
  'Morning: roadmap review with demos',
  'Afternoon: hack session',
  'Snacks',
];
/** The script runs about 20 s. */
const SCRIPT_MS = 40_000;

async function openExample(page: Page) {
  await page.goto('/new?example');
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/, { timeout: 15_000 });
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  for (const text of SEEDED) {
    await expect(editor(page)).toContainText(text);
  }
}

async function expectPlayed(page: Page, timeout = SCRIPT_MS) {
  for (const text of PLAYED) {
    await expect(editor(page)).toContainText(text, { timeout });
  }
}

async function caretNames(page: Page): Promise<string[]> {
  return (await page.getByTestId('remote-caret').allInnerTexts()).sort();
}

test('the example opens as a shared note, its demo collaborators edit it live, and blame shows three people', async ({
  context,
  otherContext,
}) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await openExample(page);
  const banner = page.getByTestId('example-banner');
  await expect(banner).toContainText('Example note');
  await expect(banner).toContainText('Ana and jot AI are demos in your browser');

  // The demo collaborators are real peers: their carets show here.
  await expect.poll(() => caretNames(page)).toEqual(['Ana (demo)', 'jot AI (demo)']);

  // A second window sees the content, and the carets, through the relay.
  const other = await otherContext.newPage();
  await other.goto(page.url());
  await expect(editor(other)).toContainText(TITLE, { timeout: 15_000 });
  await expect
    .poll(async () => (await caretNames(other)).filter((name) => name.endsWith('(demo)')))
    .toEqual(['Ana (demo)', 'jot AI (demo)']);
  // The banner is for the tab that runs the demo.
  await expect(other.getByTestId('example-banner')).toHaveCount(0);

  await expectPlayed(page);
  await expectPlayed(other, 15_000);
  await expect
    .poll(async () => (await editor(other).innerText()) === (await editor(page).innerText()))
    .toBe(true);

  // Blame is on in the example, with three people: you, Ana and jot AI.
  const chip = page.getByTestId('blame-chip');
  await expect(chip).toBeVisible();
  await chip.click();
  const people = page.getByTestId('blame-legend').getByTestId('blame-person');
  await expect(people).toHaveCount(3);
  expect((await people.locator('.person-name').allInnerTexts()).sort()).toEqual([
    'Ana (demo)',
    'You',
    'jot AI (demo)',
  ]);
  await page.keyboard.press('Escape');

  // The other window turns blame on and sees the same three, the creator by name.
  await other.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await other.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await other.keyboard.press('Escape');
  await other.getByTestId('blame-chip').click();
  await expect(other.getByTestId('blame-legend').getByTestId('blame-person')).toHaveCount(3);
});

test('under reduced motion the demo plays at once; Replay demo runs it again', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExample(page);
  await expectPlayed(page, 5_000);

  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByTestId('replay-demo').click();
  await expectPlayed(page, 5_000);
  // Played once more, not twice over.
  await expect(editor(page).getByText('Send the agenda')).toHaveCount(1);
  await expect(editor(page).getByText('Snacks')).toHaveCount(1);
  await expect(editor(page)).toContainText('roadmap review with demos');
  await expect(editor(page)).not.toContainText('with demos with demos');
});

test('a reload keeps the demo collaborators, idle; Start blank leaves them', async ({
  page,
  otherContext,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExample(page);
  await expectPlayed(page, 5_000);
  const url = page.url();

  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(page.getByTestId('example-banner')).toBeVisible();
  await expect.poll(() => caretNames(page)).toEqual(['Ana (demo)', 'jot AI (demo)']);
  // Nothing was played or seeded twice.
  await expect(editor(page).getByText('Send the agenda')).toHaveCount(1);
  await expect(editor(page).getByText(TITLE)).toHaveCount(1);

  const other = await otherContext.newPage();
  await other.goto(url);
  await expect
    .poll(async () => (await caretNames(other)).filter((name) => name.endsWith('(demo)')))
    .toEqual(['Ana (demo)', 'jot AI (demo)']);

  // Leaving the page stops the demo: its collaborators leave the note.
  await page.getByTestId('example-banner').getByRole('link', { name: 'Start blank' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByTestId('status-pill')).toHaveText('Only on this device');
  await expect
    .poll(async () => (await caretNames(other)).filter((name) => name.endsWith('(demo)')))
    .toEqual([]);
  // The example stays at its link.
  await expect(editor(other)).toContainText('Afternoon: hack session');
});

test('Copy link in the banner copies the note link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openExample(page);
  await page.getByTestId('example-banner').getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByTestId('example-banner')).toContainText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});
