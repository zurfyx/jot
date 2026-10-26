import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { writeRawNote } from './raw-client';

// Two pages in one context: each page is its own Yjs client. (Chromium's
// single-process mode, used in sandboxed shells, allows one context.)

test('the status pill shows the size, and the avatars the people here', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openNote(a, id);
  await expect(a.getByTestId('status-pill')).toHaveText(/^Synced · \d+(\.\d)? (B|KB)$/);
  await expect(a.getByTestId('avatars')).toHaveAttribute('data-count', '1');
  await openNote(b, id);
  await expect(a.getByTestId('avatars')).toHaveAttribute('data-count', '2');
  await expect(a.locator('.avatar')).toHaveCount(2);
  await b.close();
  await expect(a.getByTestId('avatars')).toHaveAttribute('data-count', '1');
});

test('two pages on one note type and converge', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openNote(a, id);
  await openNote(b, id);

  await editor(a).click();
  await a.keyboard.type('Launch plan');
  await expect(editor(b)).toContainText('Launch plan');

  await editor(b).click();
  await b.keyboard.press('ControlOrMeta+End');
  await b.keyboard.press('Enter');
  await b.keyboard.type('Second line from B');
  await a.keyboard.press('ControlOrMeta+End');
  await a.keyboard.press('Enter');
  await a.keyboard.type('Third line from A');

  await expect(editor(a)).toContainText('Second line from B');
  await expect(editor(b)).toContainText('Third line from A');
  await expect
    .poll(async () => [await editor(a).innerText(), await editor(b).innerText()])
    .toEqual([await editor(b).innerText(), await editor(a).innerText()]);
  await expect(a).toHaveTitle('Launch plan · jot');

  // B sees A's caret, labelled with A's name.
  await expect(b.getByTestId('remote-caret')).toHaveCount(1);
});

test('a reload keeps the note', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Still here after a reload');
  // The Durable Object saves a few seconds after the last edit, and at once
  // when the last client leaves.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await expect(editor(page)).toContainText('Still here after a reload');
});

test('Share copies the link', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = freshNoteId();
  await openNote(page, id);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('markdown shortcuts and the Aa menu format text', async ({ page }) => {
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Heading');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item');
  await expect(editor(page).locator('h2')).toHaveText('Heading');
  await expect(editor(page).locator('ul li')).toHaveText('item');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('make me bold');
  for (let i = 0; i < 'make me bold'.length; i++) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  // No toolbar appears over a selection: formatting lives behind Aa.
  await expect(page.getByRole('toolbar', { name: 'Format' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Format' }).click();
  const menu = page.getByRole('menu', { name: 'Format' });
  await menu.getByRole('menuitemcheckbox', { name: 'Bold' }).click();
  await expect(editor(page).locator('.jot-bold')).toHaveText('make me bold');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Bold' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await menu.getByRole('menuitemcheckbox', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link address').fill('lexical.dev');
  await page.getByLabel('Link address').press('Enter');
  await expect(editor(page).locator('a')).toHaveAttribute('href', 'https://lexical.dev/');
  await expect(menu).toBeHidden();
});

test('the command menu toggles the theme', async ({ page }) => {
  await openNote(page, freshNoteId());
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Commands' })).toBeVisible();
  await page.keyboard.type('theme');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Commands' })).toBeHidden();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
});

test('offline edits sync on reconnect', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  // A's socket goes through Playwright, so the test can cut it.
  let offline = false;
  const sockets = new Set<{ close: () => Promise<void> }>();
  await a.routeWebSocket(/\/api\/n\//, (ws) => {
    if (offline) {
      void ws.close();
      return;
    }
    ws.connectToServer();
    sockets.add(ws);
    ws.onClose(() => sockets.delete(ws));
  });
  await openNote(a, id);
  await openNote(b, id);
  await editor(a).click();
  await a.keyboard.type('Shared line');
  await expect(editor(b)).toContainText('Shared line');

  offline = true;
  for (const ws of sockets) await ws.close();
  await expect(a.getByTestId('status-pill')).toHaveText('Offline · no edits waiting');
  await a.keyboard.press('Enter');
  await a.keyboard.type('Written offline');
  await expect(a.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits waiting$/);
  await editor(b).click();
  await b.keyboard.press('ControlOrMeta+End');
  await b.keyboard.press('Enter');
  await b.keyboard.type('Written online');
  await expect(editor(b)).not.toContainText('Written offline');

  offline = false;
  await expect(a.getByTestId('status-pill')).toHaveText('Back online · merged', {
    timeout: 15_000,
  });
  await expect(editor(b)).toContainText('Written offline');
  await expect(editor(a)).toContainText('Written online');
});

test('a note from a newer layout opens read only', async ({ page, baseURL }) => {
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => {
    const root = doc.get('lexical-y');
    root.setAttr('lexical-y', 99);
    root.insert(0, 'From the future');
  });
  await page.goto(`/n/${id}`);
  await expect(page.getByTestId('status-pill')).toHaveText('Read only');
  await expect(page.getByText('This note was written by a newer version of jot')).toBeVisible();
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
});
