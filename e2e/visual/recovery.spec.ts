import type { BrowserContext, Page } from '@playwright/test';

import { writeRawNote } from '../raw-client';
import {
  ANA,
  GERARD,
  chrome,
  editor,
  expect,
  freshNoteId,
  openMore,
  openNote,
  pageFor,
  rest,
  shoot,
  test,
} from './setup';

/**
 * The generation fence's screens (D34, D37): offline edits that didn't merge,
 * written into the note; offline edits saved apart in the note where a
 * browser has no store (the banner, viewed, ⋯ → Offline edits, the upload);
 * edits not saved on this device; and the reload notice.
 */

/** A browser without IndexedDB: its offline edits go to the note's records (D34). */
async function withoutStore(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
  });
}

async function replaceIncarnation(page: Page, id: string) {
  const response = await page.request.post(`/api/test/n/${id}/replace-incarnation`);
  expect(response.status()).toBe(200);
}

/** Someone writes offline while the note moves on; returns once their edits are saved apart. */
async function savedApart(page: Page, id: string, line = 'Written on the train', intro = true) {
  await openNote(page, id);
  await editor(page).click();
  if (intro) {
    await page.keyboard.type('A shared plan');
  }
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline/);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(line);
  await replaceIncarnation(page, id);
  await chrome(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('recovery-banner')).toBeVisible({ timeout: 15_000 });
}

test('offline edits saved apart: the banner', async ({ context }) => {
  await withoutStore(context);
  const page = await pageFor(context, GERARD);
  await savedApart(page, freshNoteId());
  await rest(page);
  await shoot(page, 'recovery-banner');
});

test('offline edits saved apart: viewed', async ({ context }) => {
  await withoutStore(context);
  const page = await pageFor(context, GERARD);
  await savedApart(page, freshNoteId());
  await page.getByTestId('recovery-banner').getByRole('button', { name: 'View' }).click();
  await expect(page.getByTestId('recovery-text')).toContainText('Written on the train');
  await rest(page);
  await shoot(page, 'recovery-viewed');
});

test('offline edits under ⋯ → Offline edits, in another browser', async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
  await withoutStore(context);
  const page = await pageFor(context, GERARD);
  await savedApart(page, id);
  const ana = await pageFor(otherContext, ANA);
  await openNote(ana, id);
  await openMore(ana);
  await ana.getByTestId('recovery-item').click();
  await expect(ana.getByTestId('recovery-row')).toHaveCount(1);
  await rest(ana);
  await shoot(ana, 'recovery-panel');
});

test('offline edits that didn’t merge, written into the note', async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
  const page = await pageFor(context, GERARD);
  const ana = await pageFor(otherContext, ANA);
  await openNote(page, id);
  await openNote(ana, id);
  await editor(page).click();
  await page.keyboard.insertText('A shared plan');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Lunch at noon');
  await expect(editor(ana)).toContainText('Lunch at noon');
  // Gerard goes offline and changes the second line; Ana changes it too.
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline/);
  await editor(page).getByText('Lunch at noon').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(', on the terrace');
  // Ana's page reconnects into the note as it is (a new socket) before she types:
  // an edit she made before that would be hers to recover too.
  const sockets: string[] = [];
  ana.on('websocket', (socket) => sockets.push(socket.url()));
  await replaceIncarnation(page, id);
  await expect.poll(() => sockets.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect(ana.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await editor(ana).getByText('Lunch at noon').click();
  await ana.keyboard.press('End');
  await ana.keyboard.insertText(' sharp');
  await expect(ana.getByTestId('status-pill')).toContainText('Synced');
  await chrome(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(editor(page).locator('blockquote')).toHaveText('Lunch at noon, on the terrace', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await rest(page);
  await shoot(page, 'offline-leftovers');
});

test('saving offline edits', async ({ context }) => {
  // No store on this device: the edits are uploaded to the note (D34).
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
  });
  const page = await pageFor(context, GERARD);
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('A shared plan');
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline/);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Written on the train');
  // The upload never gets an answer: the page stays where it saves.
  await page.route(/\/recovery$/, () => {});
  await replaceIncarnation(page, id);
  await chrome(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('status-pill')).toHaveText('Saving offline edits…');
  await rest(page);
  await shoot(page, 'recovery-saving');
});

test('edits not saved on this device', async ({ context }) => {
  // The store opens, then refuses every write (a full disk).
  await context.addInitScript(() => {
    const refuse = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    IDBObjectStore.prototype.put = refuse;
    IDBObjectStore.prototype.add = refuse;
  });
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  // Offline before anything is typed, so every edit waits: three of them.
  await page.getByTestId('status-pill').click();
  await editor(page).click();
  await page.keyboard.insertText('A shared plan');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Written on the train');
  await expect(page.getByText('aren’t being saved on this device')).toBeVisible();
  await expect(page.getByTestId('status-pill')).toHaveText('Offline · 3 edits waiting');
  await rest(page);
  await shoot(page, 'offline-not-saved');
});

test('a note this release cannot read', async ({ context, baseURL }) => {
  const page = await pageFor(context, GERARD);
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => {
    const root = doc.get('lexical-y');
    root.setAttr('lexical-y:99', true);
    root.insert(0, 'From the future');
  });
  await page.goto(`/n/${id}`);
  await expect(page.getByTestId('status-pill')).toHaveText('Reload to edit', { timeout: 15_000 });
  await rest(page);
  await shoot(page, 'fence-reload');
});
