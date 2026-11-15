import type { Page } from '@playwright/test';

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
 * The generation fence's screens (D34, D37): offline edits saved apart on this
 * device, the upload where there is no store, edits not saved on this device,
 * and the reload notice.
 */

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
  const page = await pageFor(context, GERARD);
  await savedApart(page, freshNoteId());
  await rest(page);
  await shoot(page, 'recovery-banner');
});

test('offline edits saved apart: viewed', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await savedApart(page, freshNoteId());
  await page.getByTestId('recovery-banner').getByRole('button', { name: 'View' }).click();
  await expect(page.getByTestId('recovery-text')).toContainText('Written on the train');
  await rest(page);
  await shoot(page, 'recovery-viewed');
});

test('offline edits under ⋯ → Offline edits, on this device and in the note', async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
  // Ana's browser has no store: her offline edits wait in the note, for everyone.
  await otherContext.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined });
  });
  const ana = await pageFor(otherContext, ANA);
  await savedApart(ana, id, 'Ana, offline');
  const page = await pageFor(context, GERARD);
  await savedApart(page, id, 'Written on the train', false);
  await openMore(page);
  await page.getByTestId('recovery-item').click();
  await expect(page.getByTestId('recovery-row')).toHaveCount(2);
  await rest(page);
  await shoot(page, 'recovery-panel');
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
