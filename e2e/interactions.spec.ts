import type { Page } from '@playwright/test';

import { withDevice, withFakeModel } from './fakes';
import { editor, expect, freshNoteId, openNote, test } from './helpers';

/**
 * Keyboard and pointer paths the feature specs don't already walk: menus
 * from the keyboard, Esc and where the focus goes after it, the dock's tab
 * order, ⌘K, blame's legend, the status pill and Share from the keyboard,
 * the feature tabs' Home and End, and the landing page's tab order.
 */

function dock(page: Page) {
  return page.getByTestId('dock');
}

async function writeLine(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text);
}

test('Aa from the keyboard: arrows move, Enter applies and gives the caret back', async ({
  page,
}) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'A heading');
  const aa = dock(page).getByRole('button', { name: 'Format' });
  await aa.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Format' });
  const item = (name: RegExp) => menu.getByRole('menuitemradio', { name });
  await expect(item(/^Text/)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(/Heading 1/)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  // Up from the first item wraps to the last enabled one: the text formats
  // come after the blocks, and Link is disabled without a selection.
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Inline code' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(/^Text/)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(item(/Heading 2/)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('!');
  await expect(editor(page).locator('h2')).toHaveText('A heading!');
});

test('Aa → Link: the field takes the focus, Esc gives it back to the note', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Lexical');
  await page.keyboard.press('Shift+Home');
  await dock(page).getByRole('button', { name: 'Format' }).click();
  await page
    .getByRole('menu', { name: 'Format' })
    .getByRole('menuitemcheckbox', { name: 'Link' })
    .click();
  const field = page.getByLabel('Link address');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator('a')).toHaveCount(0);
});

test('Esc closes Aa and ⋯ and gives the focus back to the note', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');

  // Opened from the keyboard, ⋯ holds the focus; Esc hands it to the note.
  await dock(page).getByRole('button', { name: 'More' }).focus();
  await page.keyboard.press('Enter');
  const more = page.getByRole('menu', { name: 'More' });
  await expect(more.getByRole('menuitemcheckbox', { name: 'Show blame' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(' world');
  await expect(editor(page)).toHaveText('Hello world');

  // Opened with the pointer, Aa leaves the focus in the note all along; Esc
  // then closes it and, as Esc does anywhere in the note, leaves the note.
  await dock(page).getByRole('button', { name: 'Format' }).click();
  await expect(page.getByRole('menu', { name: 'Format' })).toBeVisible();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Format' })).toBeHidden();
  await expect(editor(page)).not.toBeFocused();
});

test('a second click closes a dock menu, and opening one closes the other', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');
  const aa = dock(page).getByRole('button', { name: 'Format' });
  const moreButton = dock(page).getByRole('button', { name: 'More' });
  const format = page.getByRole('menu', { name: 'Format' });
  const more = page.getByRole('menu', { name: 'More' });

  await aa.click();
  await expect(format).toBeVisible();
  await expect(aa).toHaveAttribute('aria-expanded', 'true');
  await moreButton.click();
  await expect(format).toBeHidden();
  await expect(more).toBeVisible();
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
  await expect(aa).toHaveAttribute('aria-expanded', 'false');
  await moreButton.click();
  await expect(more).toBeHidden();
  await aa.click();
  await aa.click();
  await expect(format).toBeHidden();
});

test('Tab moves through the top bar and the dock in order', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');

  const pill = page.getByTestId('status-pill');
  await pill.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();

  const aa = dock(page).getByRole('button', { name: 'Format' });
  const ask = dock(page).getByTestId('ask-ai');
  const moreButton = dock(page).getByRole('button', { name: 'More' });
  await aa.focus();
  await page.keyboard.press('Tab');
  await expect(ask).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(moreButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(ask).toBeFocused();

  // With blame on, its chip sits between Ask AI and ⋯.
  await moreButton.click();
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  const chip = page.getByTestId('blame-chip');
  await expect(chip).toBeVisible();
  await ask.focus();
  await page.keyboard.press('Tab');
  await expect(chip).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(moreButton).toBeFocused();
});

test('Note info opens from the keyboard, and Esc closes it', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');
  await dock(page).getByRole('button', { name: 'More' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: /Note info/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const info = page.getByTestId('note-info');
  await expect(info).toBeVisible();
  await expect(info).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(editor(page)).toBeFocused();
});

test('the AI model setting works from the keyboard', async ({ context }) => {
  const page = await withDevice(context, {});
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');
  await dock(page).getByRole('button', { name: 'More' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('ai-model-item')).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('model-panel');
  await expect(panel).toBeFocused();
  // The laptop default is Larger; arrow keys move the choice to Small.
  const larger = panel.getByRole('radio', { name: /Larger/ });
  const small = panel.getByRole('radio', { name: /Small/ });
  await expect(larger).toBeChecked();
  await larger.focus();
  await page.keyboard.press('ArrowUp');
  await expect(small).toBeChecked();
  await expect(small).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(editor(page)).toBeFocused();

  // The choice holds when the setting opens again.
  await dock(page).getByRole('button', { name: 'More' }).click();
  await page.getByTestId('ai-model-item').click();
  await expect(panel.getByRole('radio', { name: /Small/ })).toBeChecked();
});

test('Ask AI: the field takes the focus, and Esc gives it back to the note', async ({
  context,
}) => {
  const page = await withFakeModel(context, {});
  await openNote(page, freshNoteId());
  await writeLine(page, 'Demos, lunch, hack session');
  await dock(page).getByTestId('ask-ai').click();
  const panel = page.getByTestId('ask-panel');
  await expect(panel.getByTestId('ask-input')).toBeFocused();
  // Tab reaches the suggestions.
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Make it a list' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test('⌘K: typing filters, arrows move, Enter runs, Esc closes', async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Hello');
  // The pointer picks the option under it: keep it away from the menu.
  await page.mouse.move(0, 0);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Commands' });
  await expect(dialog.getByLabel('Command')).toBeFocused();
  const options = dialog.getByRole('option');
  const count = await options.count();
  expect(count).toBeGreaterThan(2);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.type('nothing like this');
  await expect(dialog.getByText('No matching command')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(editor(page)).toBeFocused();

  // A click on the scrim closes it too.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(dialog).toBeHidden();

  // ⌘K again closes an open menu.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeHidden();
});

test("blame's legend works from the keyboard", async ({ page }) => {
  await openNote(page, freshNoteId());
  await writeLine(page, 'Written by me');
  await dock(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  const chip = page.getByTestId('blame-chip');
  await expect(chip).toBeVisible();
  await chip.focus();
  await page.keyboard.press('Enter');
  const legend = page.getByTestId('blame-legend');
  await expect(legend.getByTestId('blame-person').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(legend.getByTestId('blame-person').first()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(legend.getByRole('menuitem', { name: 'Hide blame' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(legend).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test('the status pill toggles Work offline from the keyboard', async ({ page }) => {
  await openNote(page, freshNoteId());
  const pill = page.getByTestId('status-pill');
  await pill.focus();
  await page.keyboard.press('Space');
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toHaveText(/^Offline · /);
  const reconnect = page.getByRole('button', { name: 'Reconnect' });
  await expect(reconnect).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(reconnect).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await expect(reconnect).toBeHidden();
  await expect(pill).toHaveText(/^(Back online · merged|Synced · )/);
});

test('⋯ → Work offline from the keyboard keeps the menu open', async ({ page }) => {
  await openNote(page, freshNoteId());
  await dock(page).getByRole('button', { name: 'More' }).focus();
  await page.keyboard.press('Enter');
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Work offline' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('status-pill')).toHaveText(/^Offline · /);
  await expect(toggle).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('Share works from the keyboard', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNote(page, freshNoteId());
  await page.getByRole('button', { name: 'Share' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  // It says so for a moment, then reads Share again.
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible({ timeout: 5_000 });
});

test('the feature tabs: Home, End, and arrows that wrap', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Features' });
  const tab = (name: string) => tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
  await tab('Blame').click();
  await expect(tab('Blame')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab('AI as a collaborator')).toBeFocused();
  await expect(tab('AI as a collaborator')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tab('Live cursors')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('AI as a collaborator')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('Live cursors')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(tab('AI as a collaborator')).toHaveAttribute('aria-selected', 'true');
  // Only the chosen tab is in the tab order.
  await expect(tabs.getByRole('tab').and(page.locator('[tabindex="0"]'))).toHaveCount(1);
});

test("the landing page's tab order", async ({ page }) => {
  await page.goto('/');
  const order: string[] = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (element === null) {
          return '';
        }
        return (
          element.getAttribute('aria-label') ??
          (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        );
      }),
    );
  }
  expect(order).toEqual([
    'jot, home',
    'Docs',
    'GitHub',
    expect.stringMatching(/^Start a new note/),
    'See the example',
    'Note link or code',
    // The paste field's Open is disabled while the field is empty.
    'Open the example',
    'Open a new note',
    expect.stringMatching(/^Live cursors/),
  ]);
});

test('on a phone, the docs nav button opens and closes the page list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/quick-start');
  const toggle = page.getByRole('button', { name: 'Pages' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const close = page.getByRole('button', { name: 'Close' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('docs-nav')).toBeVisible();
  await close.click();
  await expect(page.getByTestId('docs-nav')).toBeHidden();
});
