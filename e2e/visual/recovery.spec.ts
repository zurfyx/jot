import { MIN_LAYOUT } from '@lexical/y';
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

/** The generation fence's screens (D34): offline edits saved apart, and the reload notice. */

async function replaceIncarnation(page: Page, id: string) {
  const response = await page.request.post(`/api/test/n/${id}/replace-incarnation`);
  expect(response.status()).toBe(200);
}

/** Gerard writes offline while the note moves on; returns his page once his edits are saved apart. */
async function savedApart(page: Page, id: string) {
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

test('offline edits under ⋯ → Offline edits, in another browser', async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
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

test('saving offline edits', async ({ context }) => {
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
