import { RICH_NOTE } from './content';
import { withDevice } from '../fakes';
import {
  GERARD,
  ANA,
  chrome,
  dock,
  editor,
  expect,
  freshNoteId,
  openMore,
  openNote,
  pageFor,
  rest,
  setNoteContent,
  shoot,
  shootElement,
  test,
  asPerson,
} from './setup';

/** A note page: empty, rich, and its dock, menus and panels. */

test('an empty note', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await rest(page);
  await shoot(page, 'note-empty');
});

test('a note with rich content', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await setNoteContent(page, RICH_NOTE);
  await expect(editor(page).locator('table')).toBeVisible();
  await expect(page.getByTestId('status-pill')).toHaveText(/^Synced · /);
  await page.evaluate(() => window.scrollTo(0, 0));
  await rest(page);
  await shoot(page, 'note-rich', { fullPage: true });
});

test('the dock, and its Aa and ⋯ menus', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Plain words');
  await page.keyboard.press('Shift+Home');
  await rest(page);
  await shootElement(dock(page), 'note-dock');

  await dock(page).getByRole('button', { name: 'Format' }).click();
  await expect(page.getByRole('menu', { name: 'Format' })).toBeVisible();
  await rest(page);
  await shoot(page, 'note-menu-format');
  await page.keyboard.press('Escape');

  await openMore(page);
  await rest(page);
  await shoot(page, 'note-menu-more');
});

test('Note info', async ({ context, otherContext }) => {
  const id = freshNoteId();
  const page = await pageFor(context, GERARD);
  const ana = await pageFor(otherContext, ANA);
  await openNote(page, id);
  await openNote(ana, id);
  await editor(page).click();
  await page.keyboard.type('Some text to weigh');
  await expect(editor(ana)).toHaveText('Some text to weigh');
  await expect(page.getByTestId('avatars')).toHaveAttribute('data-count', '2');
  const more = await openMore(page);
  await more.getByRole('menuitem', { name: /Note info/ }).click();
  await expect(page.getByTestId('note-info')).toBeVisible();
  await rest(page);
  await shoot(page, 'note-info');
});

test('the AI model setting', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await withDevice(context, {});
  await openNote(page, freshNoteId());
  await openMore(page);
  await page.getByTestId('ai-model-item').click();
  const panel = page.getByTestId('model-panel');
  await expect(panel.getByTestId('model-small-state')).toHaveText(/Needs download/);
  await rest(page);
  await shoot(page, 'note-ai-model');
});

test('Share, after a copy', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await chrome(page).getByRole('button', { name: 'Share' }).click();
  await expect(chrome(page).getByRole('button', { name: 'Link copied' })).toBeVisible();
  await rest(page);
  await shootElement(chrome(page), 'note-share-copied');
});

test('Aa → Link: the link field', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Lexical');
  await page.keyboard.press('Shift+Home');
  await dock(page).getByRole('button', { name: 'Format' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Link' }).click();
  await expect(page.getByLabel('Link address')).toBeFocused();
  await rest(page);
  await shoot(page, 'note-link-field');
});

test('the ⌘K command menu', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await rest(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
  await shoot(page, 'note-command-menu');
});

test('focus rings: the dock and a menu opened from the keyboard', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await rest(page);
  // Keyboard focus, so :focus-visible applies.
  await dock(page).getByRole('button', { name: 'Format' }).focus();
  await page.keyboard.press('Tab');
  await expect(dock(page).getByTestId('ask-ai')).toBeFocused();
  await shootElement(dock(page), 'focus-dock');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show blame' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await shoot(page, 'focus-menu-item');
});
