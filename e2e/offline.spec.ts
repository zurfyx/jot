import { type Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { flakyLink, holdOutgoingContent } from './sockets';

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

test('Work offline in two windows, then reconnecting merges both sides', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openNote(a, id);
  await openNote(b, id);
  await editor(a).click();
  await a.keyboard.type('Plan');
  await expect(editor(b)).toContainText('Plan');

  await workOffline(a);
  await expect(a.getByTestId('status-pill')).toHaveText('Offline · no edits waiting');
  await expect(a.getByTestId('status-pill')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  // The pill toggles it too.
  await b.getByTestId('status-pill').click();
  await expect(b.getByTestId('status-pill')).toHaveText('Offline · no edits waiting');

  await appendLine(a, 'From A, offline');
  await appendLine(b, 'From B, offline');
  await expect(a.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);
  await expect(b.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);
  await expect(editor(a)).not.toContainText('From B');
  await expect(editor(b)).not.toContainText('From A');
  // Both stay editable while offline.
  await expect(editor(a)).toHaveAttribute('contenteditable', 'true');

  await a.getByRole('button', { name: 'Reconnect' }).click();
  await expect(a.getByTestId('status-pill')).toHaveText('Back online · merged');
  await b.getByTestId('status-pill').click();
  await expect(b.getByTestId('status-pill')).toHaveText('Back online · merged');

  await expect(editor(a)).toContainText('From B, offline');
  await expect(editor(b)).toContainText('From A, offline');
  await expect
    .poll(async () => (await editor(a).innerText()) === (await editor(b).innerText()))
    .toBe(true);
  // The flash ends after about four seconds.
  await expect(a.getByTestId('status-pill')).toHaveText(/^Synced · /, { timeout: 8000 });
});

test('the browser coming back online does not end Work offline', async ({ page }) => {
  await openNote(page, freshNoteId());
  await workOffline(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('status-pill')).toHaveText('Offline · no edits waiting');
});

test('reconnecting is not "merged" until the server confirms the edits', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  const socket = await holdOutgoingContent(a);
  await openNote(a, id);
  await openNote(b, id);

  await workOffline(a);
  await appendLine(a, 'Held back');
  await expect(a.getByTestId('status-pill')).toHaveText(/^Offline · [1-9]\d* edits? waiting$/);

  // The server syncs A, but A's edits don't reach it yet.
  socket.hold = true;
  await a.getByRole('button', { name: 'Reconnect' }).click();
  await expect(a.getByTestId('status-pill')).toHaveText(/^Syncing · [1-9]\d* edits? waiting$/);
  await a.waitForTimeout(1000);
  await expect(a.getByTestId('status-pill')).toHaveText(/^Syncing · [1-9]\d* edits? waiting$/);
  await expect(editor(b)).not.toContainText('Held back');

  socket.release();
  await expect(a.getByTestId('status-pill')).toHaveText('Back online · merged');
  await expect(editor(b)).toContainText('Held back');
});

test('edits a dead link swallowed count as waiting once the drop is noticed', async ({
  context,
}) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  const link = await flakyLink(a);
  await openNote(a, id);
  await openNote(b, id);

  // The link dies silently: A still looks connected while it types.
  link.goSilent();
  await appendLine(a, 'Typed into a dead link');
  await expect(a.getByTestId('status-pill')).toHaveText(/^Synced · /);
  // Then the drop is noticed.
  link.drop();
  await expect(a.getByTestId('status-pill')).toHaveText(/^Offline · [1-9]\d* edits? waiting$/);
  await expect(editor(b)).not.toContainText('Typed into a dead link');

  link.restore();
  await expect(a.getByTestId('status-pill')).toHaveText('Back online · merged', {
    timeout: 15_000,
  });
  await expect(editor(b)).toContainText('Typed into a dead link');
});
