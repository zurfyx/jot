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

test('offline edits replayed, except a conflict', async ({ context, otherContext }) => {
  // A layout 1 note seeded by this build's pages: the layout 2 world only (at
  // layout 3 the offline tab is an R page, e2e/migration.spec.ts).
  test.skip(MIN_LAYOUT > 2, 'pages of a layout 3 build seed layout 3');
  const id = freshNoteId();
  const page = await pageFor(context, GERARD);
  const ana = await pageFor(otherContext, ANA);
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Topic');
  await openNote(ana, id);
  await expect(editor(ana)).toContainText('Topic');
  await page.getByTestId('status-pill').click();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline/);
  await editor(page)
    .locator('p')
    .first()
    .click({ position: { x: 1, y: 8 } });
  await page.keyboard.type('# ');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Notes from the train');
  // The release that migrates notes: floor 2 for the Worker and both pages.
  const response = await page.request.post(`/api/test/n/${id}/settings?floor=2`);
  expect(response.status()).toBe(200);
  for (const p of [page, ana]) {
    await p.evaluate(() => localStorage.setItem('jot:test-floor', '2'));
  }
  await ana.reload();
  await expect(ana.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await editor(ana)
    .locator('p')
    .first()
    .click({ position: { x: 1, y: 8 } });
  await ana.keyboard.type('> ');
  await expect(editor(ana).locator('blockquote')).toHaveText('Topic');
  await chrome(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('recovery-banner')).toContainText('except one change', {
    timeout: 15_000,
  });
  await rest(page);
  // The note's size depends on the replay's random client ids: masked.
  await shoot(page, 'recovery-replayed-conflict', { mask: [page.getByTestId('status-pill')] });
});
