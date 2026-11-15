import { type Page } from '@playwright/test';

import * as Y from '@y/y';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { readRawNote } from './raw-client';

/**
 * Unsent edits on this device (D37): what a page typed and the server has not
 * taken is kept in IndexedDB, so a reload or a closed tab loses nothing; a
 * note that moved on meanwhile gets them as a capture on this device, listed
 * under ⋯ → Offline edits, never merged.
 */

async function workOffline(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');
}

async function appendLine(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
}

/**
 * The store writes each update as it is made, in a transaction of its own; a
 * tab closed in the same instant as a keystroke can lose that one. The tests
 * close and reload as a person would, a moment after typing.
 */
async function settleWrites(page: Page) {
  await page.waitForTimeout(500);
}

async function replaceIncarnation(baseURL: string, id: string) {
  const response = await fetch(`${baseURL}/api/test/n/${id}/replace-incarnation`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  await response.text();
}

function noteText(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return JSON.stringify(doc.get('lexical-y').toJSON());
}

test('edits typed offline survive a reload and then sync', async ({ context, baseURL }) => {
  const id = freshNoteId();
  const page = await context.newPage();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Before');
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await workOffline(page);
  await appendLine(page, 'Typed offline, then reloaded');
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);
  // The server never saw it.
  expect(noteText(await readRawNote(baseURL!, id))).not.toContain('Typed offline');

  await settleWrites(page);
  // A reload (Work offline does not survive it): the page starts from what this
  // device kept, at the note's generation, and syncs it.
  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(editor(page)).toContainText('Typed offline, then reloaded');
  await expect
    .poll(async () => noteText(await readRawNote(baseURL!, id)))
    .toContain('Typed offline, then reloaded');
  const other = await context.newPage();
  await openNote(other, id);
  await expect(editor(other)).toContainText('Typed offline, then reloaded');
  // Nothing was saved apart.
  await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
});

test('a tab closed with edits waiting, on a note that moved on, keeps them on this device', async ({
  context,
  otherContext,
  baseURL,
}) => {
  const id = freshNoteId();
  const page = await context.newPage();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Shared start');
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await workOffline(page);
  await appendLine(page, 'Kept on this device');
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);
  await settleWrites(page);
  await page.close();

  // The note moves on while no tab holds it (a migration, or a note created again).
  await replaceIncarnation(baseURL!, id);

  const back = await context.newPage();
  await openNote(back, id);
  await expect(back.getByTestId('recovery-banner')).toBeVisible({ timeout: 15_000 });
  await expect(back.getByTestId('recovery-banner')).toContainText('saved on this device');
  await expect(back.getByTestId('status-pill')).toContainText('Synced');
  await expect(editor(back)).toContainText('Shared start');
  await expect(editor(back)).not.toContainText('Kept on this device');
  expect(noteText(await readRawNote(baseURL!, id))).not.toContain('Kept on this device');
  await back.getByTestId('recovery-banner').getByRole('button', { name: 'View' }).click();
  await expect(back.getByTestId('recovery-text')).toContainText('Kept on this device');

  // Listed under ⋯ → Offline edits as this device's, and only in this browser.
  await back.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await back.getByTestId('recovery-item').click();
  const rows = back.getByTestId('recovery-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('On this device');
  const elsewhere = await otherContext.newPage();
  await openNote(elsewhere, id);
  await elsewhere.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await expect(elsewhere.getByTestId('recovery-item')).toHaveCount(0);
  await elsewhere.keyboard.press('Escape');

  // Removed, it is gone after a reload too.
  await rows.first().getByRole('button', { name: 'Remove' }).click();
  await expect(rows).toHaveCount(0);
  await back.reload();
  await expect(back.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(back.getByTestId('recovery-banner')).toHaveCount(0);
});

test('when the device refuses to store edits, the page says so and keeps them', async ({
  context,
}) => {
  await context.addInitScript(() => {
    const refuse = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    IDBObjectStore.prototype.put = refuse;
    IDBObjectStore.prototype.add = refuse;
  });
  const id = freshNoteId();
  const page = await context.newPage();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Before');
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await workOffline(page);
  await appendLine(page, 'Only in this page');
  await expect(page.getByText('aren’t being saved on this device')).toBeVisible();
  // Still editable, and the edits sync once the page reconnects.
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(page.getByText('aren’t being saved on this device')).toHaveCount(0);
  const other = await context.newPage();
  await openNote(other, id);
  await expect(editor(other)).toContainText('Only in this page');
});
