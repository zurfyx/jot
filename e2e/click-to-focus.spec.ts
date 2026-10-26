import { type Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';

/** Gives the focus away, so a test proves the click brought it back. */
async function blurEditor(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(editor(page)).not.toBeFocused();
}

/** Leaves the caret at the start of the note. */
async function caretToStart(page: Page) {
  await editor(page)
    .locator(':scope > *')
    .first()
    .click({ position: { x: 1, y: 4 } });
}

/** A point on the blank page below the note's last block, left of the column, above the dock. */
async function belowTheText(page: Page) {
  const last = await editor(page).locator(':scope > *').last().boundingBox();
  const dock = await page.getByTestId('dock').boundingBox();
  expect(last).not.toBeNull();
  expect(dock).not.toBeNull();
  const y = Math.min(last!.y + last!.height + 120, dock!.y - 20);
  expect(y).toBeGreaterThan(last!.y + last!.height);
  return { x: 8, y };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('a click below an empty note writes into it', async ({ page }) => {
      await openNote(page, freshNoteId());
      await blurEditor(page);
      const { x, y } = await belowTheText(page);
      await page.mouse.click(x, y);
      await expect(editor(page)).toBeFocused();
      await page.keyboard.type('Hello from below');
      await expect(editor(page)).toHaveText('Hello from below');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('a click below the text puts the caret at the end', async ({ page }) => {
      await openNote(page, freshNoteId());
      await editor(page).click();
      await page.keyboard.type('Title');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second line');
      await caretToStart(page);
      await blurEditor(page);
      const { x, y } = await belowTheText(page);
      await page.mouse.click(x, y);
      await page.keyboard.type(' ends here');
      await expect(editor(page).locator(':scope > *')).toHaveText([
        'Title',
        'Second line ends here',
      ]);
    });

    test('a click in the margin beside a line puts the caret in that line', async ({ page }) => {
      await openNote(page, freshNoteId());
      await editor(page).click();
      await page.keyboard.type('Title');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Middle');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Last');
      await blurEditor(page);
      const middle = await editor(page).locator(':scope > *').nth(1).boundingBox();
      expect(middle).not.toBeNull();
      // Right of the column (in its padding on a phone), level with the line.
      await page.mouse.click(viewport.width - 4, middle!.y + middle!.height / 2);
      await page.keyboard.type('!');
      await expect(editor(page).locator(':scope > *')).toHaveText(['Title', 'Middle!', 'Last']);
    });
  });
}

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap below the text writes at the end', async ({ page }) => {
    await openNote(page, freshNoteId());
    await editor(page).tap();
    await page.keyboard.type('Tapped');
    await caretToStart(page);
    await blurEditor(page);
    const { x, y } = await belowTheText(page);
    await page.touchscreen.tap(x, y);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type(' in');
    await expect(editor(page)).toHaveText('Tapped in');
  });
});

test('the blank page leaves menus and selection drags alone', async ({ page }) => {
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Keep me selected');

  // A press outside an open menu only closes it: the caret stays where it was.
  await caretToStart(page);
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  const { x, y } = await belowTheText(page);
  await page.mouse.click(x, y);
  await expect(page.getByRole('menu')).toBeHidden();
  await editor(page).focus();
  await page.keyboard.type('Still ');
  await expect(editor(page)).toHaveText('Still Keep me selected');
  await blurEditor(page);

  // A click on the dock's empty sides (outside the dock itself) still writes.
  const dock = await page.getByTestId('dock').boundingBox();
  await page.mouse.click(4, dock!.y + dock!.height / 2);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(' too');
  await expect(editor(page)).toHaveText('Still Keep me selected too');

  // A drag from the text onto the blank page keeps its selection.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Drag over this line');
  const line = await editor(page).locator(':scope > *').first().boundingBox();
  await page.mouse.move(line!.x + 2, line!.y + line!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain('Drag over this line');
});
