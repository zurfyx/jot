import { editor, expect, test } from './helpers';
import { holdOutgoingContent, neverConnect } from './sockets';

test('a new note is a draft on this device that survives a reload', async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByTestId('status-pill')).toHaveText('Only on this device');
  await expect(page.getByText('It stays on this device until you press Share.')).toBeVisible();
  // Nothing to wait for: the editor is ready at once.
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await editor(page).click();
  await page.keyboard.type('Draft title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Written before any link exists');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('jot:draft') !== null))
    .toBe(true);
  // The draft is written half a second after the last change.
  await page.waitForTimeout(700);

  await page.reload();
  await expect(page).toHaveURL(/\/new$/);
  await expect(editor(page)).toContainText('Written before any link exists');
  await expect(page).toHaveTitle('Draft title · jot');

  // ⋯ → New note starts an empty draft.
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(editor(page)).not.toContainText('Draft title');
  await expect(page.getByText('Untitled')).toBeVisible();
  await page.reload();
  await expect(editor(page)).not.toContainText('Draft title');
});

test('Share turns a draft into /n/<id>, and a second window sees the same content', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/new');
  await editor(page).click();
  await page.keyboard.type('Shared draft');
  await page.keyboard.press('Enter');
  // Typos and fixes: the draft holds deleted content too.
  await page.keyboard.type('First lien');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ne');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- a list item');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]{21}[AQgw]$/);
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  await expect(page.getByTestId('status-pill')).toHaveText(/^Synced · /);
  // Cleared once the relay has confirmed the content.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('jot:draft'))).toBeNull();
  // Same editor, still editable.
  await expect(editor(page)).toContainText('First line');

  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByTestId('status-pill')).toHaveText(/^Synced · /);
  await expect(editor(second)).toContainText('a list item');
  expect(await editor(second).innerText()).toBe(await editor(page).innerText());
  // No doubled seed: one title, one list.
  await expect(editor(second).locator('ul li')).toHaveCount(1);
  await expect(editor(second)).not.toContainText('Shared draftShared draft');

  await editor(second).click();
  await second.keyboard.press('ControlOrMeta+End');
  await second.keyboard.press('Enter');
  await second.keyboard.type('From the second window');
  await expect(editor(page)).toContainText('From the second window');

  // /new now starts empty: the shared draft left this device.
  const third = await context.newPage();
  await third.goto('/new');
  await expect(editor(third)).not.toContainText('Shared draft');
});

test('Share on an empty draft opened in two windows at once seeds one copy', async ({
  context,
  page,
}) => {
  await page.goto('/new');
  await expect(page.getByTestId('status-pill')).toHaveText('Only on this device');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(/\/n\//);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByTestId('status-pill')).toHaveText(/^Synced · /);
  await editor(second).click();
  await second.keyboard.type('Only line');
  await expect(editor(page)).toHaveText('Only line');
  await expect(editor(page).locator('p')).toHaveCount(1);
});

const pendingKey = (url: string) => `jot:pending:${url.split('/n/')[1]}`;

test('edits after Share survive leaving while the relay never answers', async ({
  context,
  page,
}) => {
  await neverConnect(page);
  await page.goto('/new');
  await editor(page).click();
  await page.keyboard.type('Before share');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(/\/n\//);
  const url = page.url();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After share');

  // Never synced, yet the edits are counted, and Work offline says so too.
  await expect(page.getByTestId('status-pill')).toHaveText(/^Syncing · [1-9]\d* edits? waiting$/);
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline · [1-9]\d* edits? waiting$/);
  // The draft slot is free; the content waits under the note's pending key.
  expect(await page.evaluate(() => localStorage.getItem('jot:draft'))).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), pendingKey(url))).not.toBeNull();

  // Leaving at once (pagehide) keeps the edits made after Share.
  await page.goto('about:blank');

  // The next page on the link pushes the pending copy, then drops it.
  const next = await context.newPage();
  await next.goto(url);
  await expect(next.getByTestId('status-pill')).toHaveText(/^Synced · /);
  await expect(editor(next)).toContainText('Before share');
  await expect(editor(next)).toContainText('After share');
  await expect
    .poll(() => next.evaluate((key) => localStorage.getItem(key), pendingKey(url)))
    .toBeNull();
  const third = await context.newPage();
  await third.goto(url);
  await expect(editor(third)).toContainText('After share');
});

test('a delayed confirmation keeps later edits and clears only its own copy', async ({
  context,
  page,
}) => {
  const socket = await holdOutgoingContent(page);
  socket.hold = true;
  await page.goto('/new');
  await editor(page).click();
  await page.keyboard.type('Draft A');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(/\/n\//);
  const url = page.url();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After share');
  await expect(page.getByTestId('status-pill')).toHaveText(/^Syncing · [1-9]\d* edits? waiting$/);

  // Meanwhile another tab starts its own draft in the free draft slot.
  const other = await context.newPage();
  await other.goto('/new');
  await expect(editor(other)).not.toContainText('Draft A');
  await editor(other).click();
  await other.keyboard.type('Draft B');
  await expect.poll(() => other.evaluate(() => localStorage.getItem('jot:draft'))).not.toBeNull();
  await other.waitForTimeout(700);

  // The relay gets A's content late, and confirms it.
  socket.release();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Synced · /);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey(url)))
    .toBeNull();
  // B's draft is untouched.
  await other.reload();
  await expect(editor(other)).toContainText('Draft B');

  const reader = await context.newPage();
  await reader.goto(url);
  await expect(editor(reader)).toContainText('After share');
});

test('New note while a Share is unconfirmed keeps the shared content', async ({
  context,
  page,
}) => {
  await neverConnect(page);
  await page.goto('/new');
  await editor(page).click();
  await page.keyboard.type('Precious words');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(/\/n\//);
  const url = page.url();

  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(editor(page)).not.toContainText('Precious words');

  const next = await context.newPage();
  await next.goto(url);
  await expect(editor(next)).toContainText('Precious words');
});
