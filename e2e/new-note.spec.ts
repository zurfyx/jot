import type { Page } from '@playwright/test';
import * as Y from '@y/y';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { readRawNote, writeRawNote } from './raw-client';

const NOTE_URL = /\/n\/([\w-]{22})$/;

async function expectFreshNote(page: Page): Promise<string> {
  await expect(page).toHaveURL(NOTE_URL, { timeout: 15_000 });
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  return NOTE_URL.exec(page.url())![1]!;
}

/** What an earlier version of jot kept in localStorage: a draft and pending copies. */
function storedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter(
      (key) => key === 'jot:draft' || key.startsWith('jot:pending:'),
    ),
  );
}

/** A note written in a browser, as an earlier version of jot stored a draft: `{ id, state }`. */
async function storedNote(page: Page, baseURL: string, lines: string[]) {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type(lines.join('\n'));
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await page.close();
  const state = Buffer.from(await readRawNote(baseURL, id)).toString('base64');
  return JSON.stringify({ id: 'old-draft', state });
}

/** Stores `copy` as an earlier version kept a shared note's unconfirmed copy. */
async function storeCopy(page: Page, id: string, copy: string) {
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`jot:pending:${id}`, copy],
  );
}

/** Text that doesn't compress into fewer Yjs bytes. */
function filler(length: number): string {
  let text = '';
  while (text.length < length) {
    text += Math.random().toString(36).slice(2);
  }
  return text.slice(0, length);
}

test('Start a new note opens a shared note at once, and a second window joins it', async ({
  page,
  otherContext,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  const id = await expectFreshNote(page);
  await expect(page.getByText('Start writing. Anyone with this link can edit.')).toBeVisible();
  await page.keyboard.type('Plan for Thursday');

  const other = await otherContext.newPage();
  await openNote(other, id);
  await expect(editor(other)).toHaveText('Plan for Thursday');
  await other.keyboard.type('!');
  await expect(editor(page)).toContainText('!');

  await page.reload();
  await expect(editor(page)).toContainText('Plan for Thursday');
  expect(await storedKeys(page)).toEqual([]);
});

test('/new redirects to a fresh note each time, without a history entry', async ({ page }) => {
  await page.goto('/');
  await page.goto('/new');
  const first = await expectFreshNote(page);
  await page.goto('/new');
  const second = await expectFreshNote(page);
  expect(second).not.toBe(first);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/n/${first}$`));
});

test('⋯ → New note and ⌘K → New note open another fresh note', async ({ page }) => {
  await page.goto('/new');
  const first = await expectFreshNote(page);
  await editor(page).click();
  await page.keyboard.type('First');

  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'New note' }).click();
  const second = await expectFreshNote(page);
  expect(second).not.toBe(first);
  await expect(editor(page)).toHaveText('');

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('New note');
  await page.keyboard.press('Enter');
  const third = await expectFreshNote(page);
  expect([first, second]).not.toContain(third);
});

test("a draft left by jot's earlier version moves into the next new note, once", async ({
  page,
  otherContext,
  baseURL,
}) => {
  const draft = await storedNote(await otherContext.newPage(), baseURL!, [
    'Draft from before',
    'Second line',
  ]);
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('jot:draft', value), draft);
  await page.reload();

  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  const id = await expectFreshNote(page);
  await expect(editor(page).locator('p')).toHaveText(['Draft from before', 'Second line']);
  // Pushed to the relay, then cleared.
  await expect.poll(() => storedKeys(page)).toEqual([]);
  const other = await otherContext.newPage();
  await openNote(other, id);
  await expect(editor(other).locator('p')).toHaveText(['Draft from before', 'Second line']);

  // Only once: the next new note is empty.
  await page.goto('/new');
  await expectFreshNote(page);
  await expect(editor(page)).toHaveText('');
});

test("a note copy left by jot's earlier version reaches its note when a page opens", async ({
  page,
  otherContext,
  baseURL,
}) => {
  const copy = await storedNote(await otherContext.newPage(), baseURL!, ['Shared, then closed']);
  const pendingId = freshNoteId();
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key!, value!),
    [`jot:pending:${pendingId}`, copy],
  );

  await page.goto('/new');
  const id = await expectFreshNote(page);
  expect(id).not.toBe(pendingId);
  await expect.poll(() => storedKeys(page)).toEqual([]);
  // The copy went to its own note, not the new one.
  await expect(editor(page)).toHaveText('');
  const other = await otherContext.newPage();
  await openNote(other, pendingId);
  await expect(editor(other)).toHaveText('Shared, then closed');
});

test('a draft is claimed only when the note opens: a page left during a slow load keeps it', async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('jot:draft', '{"id":"d","state":"AA=="}'));
  // The editor chunk never arrives.
  await page.route('**/src/client/editor/NotePage.tsx*', () => undefined);
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/$/);
  expect(await storedKeys(page)).toEqual(['jot:draft']);
  await page.close();

  const later = await context.newPage();
  await later.goto('/');
  expect(await storedKeys(later)).toEqual(['jot:draft']);
});

test('with storage denied, /new and Start a new note still open a fresh note', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await page.goto('/new');
  const first = await expectFreshNote(page);
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  expect(await expectFreshNote(page)).not.toBe(first);
});

test('a copy the server already holds, deletions included, is cleared and changes nothing', async ({
  page,
  otherContext,
  baseURL,
}) => {
  const id = freshNoteId();
  const writer = await otherContext.newPage();
  await openNote(writer, id);
  await editor(writer).click();
  await writer.keyboard.type('Hello world');
  for (let i = 0; i < 6; i++) {
    await writer.keyboard.press('Backspace');
  }
  await expect(writer.getByTestId('status-pill')).toContainText('Synced');
  await expect.poll(async () => (await readRawNote(baseURL!, id)).byteLength).toBeGreaterThan(0);
  const copy = JSON.stringify({
    id: 'old',
    state: Buffer.from(await readRawNote(baseURL!, id)).toString('base64'),
  });
  await writer.keyboard.type(' again');
  await expect(editor(writer)).toHaveText('Hello again');
  await expect(writer.getByTestId('status-pill')).toContainText('Synced');

  await storeCopy(page, id, copy);
  await page.goto('/new');
  await expectFreshNote(page);
  await expect.poll(() => storedKeys(page)).toEqual([]);
  await expect(editor(writer)).toHaveText('Hello again');
});

test('a copy for a full note is dropped, not retried on every page', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const id = freshNoteId();
  // Two writes, each under the relay's message size, fill the note near the cap.
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(950_000)));
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(950_000)));
  const doc = new Y.Doc();
  doc.get('copy').insert(0, `COPY${filler(200_000)}`);
  const copy = JSON.stringify({
    id: 'old',
    state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
  });

  const sockets: string[] = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await storeCopy(page, id, copy);
  await page.goto('/new');
  await expectFreshNote(page);
  await expect.poll(() => storedKeys(page), { timeout: 15_000 }).toEqual([]);
  const server = new Y.Doc();
  Y.applyUpdate(server, await readRawNote(baseURL!, id));
  expect(server.get('copy').toString()).not.toContain('COPY');
  expect(sockets.filter((url) => url.includes(id))).toHaveLength(1);

  // The next note page leaves that note alone.
  await page.goto('/new');
  await expectFreshNote(page);
  await page.waitForTimeout(500);
  expect(sockets.filter((url) => url.includes(id))).toHaveLength(1);
});
