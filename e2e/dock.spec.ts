import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { writeRawNote } from './raw-client';

test('the dock holds Aa, Ask AI and ⋯, and their menus act', async ({ page }) => {
  await openNote(page, freshNoteId());
  const dock = page.getByTestId('dock');
  await expect(dock.getByRole('button')).toHaveText(['Aa', 'Ask AI…', '']);

  await editor(page).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A heading');

  await dock.getByRole('button', { name: 'Format' }).click();
  const format = page.getByRole('menu', { name: 'Format' });
  await expect(format.getByRole('menuitemradio')).toHaveText([
    'Text',
    /Heading 1/,
    /Heading 2/,
    /Heading 3/,
    /Bulleted list/,
    /Numbered list/,
    /Todo list/,
    /Quote/,
    /Code/,
  ]);
  await expect(format.getByRole('menuitemradio', { name: 'Text' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await format.getByRole('menuitemradio', { name: /Heading 2/ }).click();
  await expect(format).toBeHidden();
  await expect(editor(page).locator('h2')).toHaveText('A heading');

  await dock.getByRole('button', { name: 'Format' }).click();
  await format.getByRole('menuitemradio', { name: /Todo list/ }).click();
  await expect(editor(page).locator('.jot-checklist li')).toHaveText('A heading');

  await dock.getByRole('button', { name: 'Format' }).click();
  await format.getByRole('menuitemradio', { name: /Code/ }).click();
  await expect(editor(page).locator('code.jot-codeblock')).toHaveText('A heading');

  // ⋯: the actions, Escape closes it.
  await dock.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('menu', { name: 'More' });
  await expect(more.locator('[role^="menuitem"]')).toHaveText([
    'Show blame',
    /Note info/,
    'Work offline',
    /Copy link/,
    'New note',
    'Dark theme',
  ]);
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();

  // Dark theme is a toggle.
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
  await dock.getByRole('button', { name: 'More' }).click();
  const toggle = more.getByRole('menuitemcheckbox', { name: 'Dark theme' });
  await expect(toggle).toHaveAttribute('aria-checked', String(before === 'dark'));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(before !== 'dark'));
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    before === 'dark' ? 'light' : 'dark',
  );
});

test('the ⋯ menu works from the keyboard', async ({ page }) => {
  await openNote(page, freshNoteId());
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).focus();
  await page.keyboard.press('Enter');
  const more = page.getByRole('menu', { name: 'More' });
  await expect(more.getByRole('menuitemcheckbox', { name: 'Show blame' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(more.getByRole('menuitem', { name: /Note info/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(more.getByRole('menuitemcheckbox', { name: 'Work offline' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(more.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeHidden();
});

test('Note info shows the size, who is here and how long the note is kept', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openNote(a, id);
  await openNote(b, id);
  await editor(a).click();
  await a.keyboard.type('Some text to weigh');

  await a.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  const size = await a
    .getByRole('menu', { name: 'More' })
    .getByRole('menuitem', { name: /Note info/ })
    .innerText();
  expect(size).toMatch(/\d+(\.\d)? (B|KB)$/);
  await a.getByRole('menuitem', { name: /Note info/ }).click();

  const info = a.getByTestId('note-info');
  await expect(info).toBeVisible();
  await expect(info.getByTestId('note-info-size')).toHaveText(/^\d+(\.\d)? (B|KB)$/);
  await expect(info).toContainText('of 2 MB');
  await expect(info.getByRole('meter', { name: 'Yjs size' })).toBeVisible();
  await expect(info.locator('.note-info-people li')).toHaveCount(2);
  await expect(info.locator('.note-info-people li').first()).toContainText('(you)');
  await expect(info.locator('.note-info-people li').first()).toContainText('editing');
  await expect(info).toContainText('90 days after the last visit');

  // The pill carries the same size (read together: a save or the people
  // registry can change it while the test runs).
  await expect
    .poll(async () => {
      const pill = (await a.getByTestId('status-pill').innerText()).replace('Synced · ', '');
      return pill === (await info.getByTestId('note-info-size').innerText());
    })
    .toBe(true);
});

test('⌘⇧C copies the note link', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Shift+C');
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('Aa is disabled on a read-only note', async ({ page, baseURL }) => {
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => {
    const root = doc.get('lexical-y');
    root.setAttr('lexical-y', 99);
    root.insert(0, 'From the future');
  });
  await page.goto(`/n/${id}`);
  await expect(page.getByTestId('status-pill')).toHaveText('Read only');
  await expect(page.getByTestId('dock').getByRole('button', { name: 'Format' })).toBeDisabled();
});

test('a note that turns read only closes an open Aa menu', async ({ page, baseURL }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Plain words');
  await page.keyboard.press('Shift+Home');
  const aa = page.getByTestId('dock').getByRole('button', { name: 'Format' });
  await aa.click();
  const menu = page.getByRole('menu', { name: 'Format' });
  await expect(menu).toBeVisible();

  // Another client marks the note with a layout this version can't write.
  await writeRawNote(baseURL!, id, (doc) => doc.get('lexical-y').setAttr('lexical-y', 99));
  await expect(page.getByTestId('status-pill')).toHaveText('Read only');
  await expect(menu).toBeHidden();
  await expect(aa).toBeDisabled();
  await expect(editor(page).locator('.jot-bold')).toHaveCount(0);
});
