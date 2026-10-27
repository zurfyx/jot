import type { Page } from '@playwright/test';

import { withDevice, withFakeModel } from '../fakes';
import {
  GERARD,
  asPerson,
  dock,
  editor,
  expect,
  freshNoteId,
  openNote,
  rest,
  shoot,
  test,
} from './setup';

/** Ask AI: the panel, the download question and progress, the unavailable message, jot AI. */

async function writeTwoLines(page: Page) {
  await editor(page).click();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Demos, lunch, hack session');
}

function askButton(page: Page) {
  return dock(page).getByTestId('ask-ai');
}

test('the Ask AI panel', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await withFakeModel(context, {});
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await expect(page.getByTestId('ask-meta')).toHaveText(/^Rewrites this block/);
  await rest(page);
  await shoot(page, 'ai-panel');
});

test('the download question, then its progress', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await withDevice(context, { mobile: true, hangLoad: true });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-consent')).toBeVisible();
  await rest(page);
  await shoot(page, 'ai-consent');

  await page.getByTestId('ask-download').click();
  // The stub stops at half the download, and stays there.
  await expect(page.getByTestId('ask-meta')).toContainText('Downloading');
  await expect(page.getByTestId('ask-meta')).toContainText('50%');
  await rest(page);
  await shoot(page, 'ai-progress');
});

test('Ask AI unavailable', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await context.newPage();
  await page.addInitScript(() => {
    delete (window as { LanguageModel?: unknown }).LanguageModel;
    Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
  });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toBeVisible();
  await rest(page);
  await shoot(page, 'ai-unavailable');
});

test("jot AI's caret", async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await withFakeModel(context, { reply: '- Roadmap\n- Team lunch\n- Hacking' });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Make it a list');
  await page.getByTestId('ask-submit').click();
  await expect(editor(page).locator('li')).toHaveText(['Roadmap', 'Team lunch', 'Hacking']);
  await expect(page.getByTestId('remote-caret').filter({ hasText: 'jot AI' })).toHaveCount(1);
  await rest(page);
  await shoot(page, 'ai-caret');
});
