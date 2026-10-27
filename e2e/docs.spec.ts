import type { Page } from '@playwright/test';

import { expect, test } from './helpers';

const PAGES: [string, string][] = [
  ['/docs', 'Learn collaborative Lexical'],
  ['/docs/quick-start', 'Quick start'],
  ['/docs/content-in-yjs', 'How content lives in Yjs'],
  ['/docs/presence', 'Presence and cursors'],
  ['/docs/offline', 'Offline and merging'],
  ['/docs/blame', 'Blame and history'],
  ['/docs/ai', 'AI as a collaborator'],
  ['/docs/size', 'Size and limits'],
  ['/docs/relay', 'The relay on Cloudflare'],
  ['/docs/server-side-editing', 'Server-side editing'],
];

function heading(page: Page) {
  return page.getByTestId('docs-main').getByRole('heading', { level: 1 });
}

test('every docs page renders, with code that has a file name and Copy', async ({ page }) => {
  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(heading(page)).toHaveText(title);
    const text = await page.getByTestId('docs-main').innerText();
    expect(text, path).not.toContain('—');
  }
  await page.goto('/docs/quick-start');
  await expect(page).toHaveTitle('Quick start · jot docs');
  const code = page.locator('.docs-code').first();
  await expect(code.locator('figcaption a')).toHaveText('quick-start.ts');
  await expect(code.locator('figcaption a')).toHaveAttribute(
    'href',
    'https://github.com/zurfyx/jot/blob/main/src/docs/snippets/quick-start.ts',
  );
  await expect(code.locator('pre')).toContainText('binding.initialize()');
});

test('Copy puts the snippet on the clipboard', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs/quick-start');
  await page.getByRole('button', { name: 'Copy quick-start.ts' }).click();
  await expect(page.getByRole('button', { name: 'Copy quick-start.ts' })).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("import { YCollabExtension } from '@lexical/y';");
});

test('the nav, Previous and Next move between pages without a reload', async ({ page }) => {
  await page.goto('/docs');
  await page.evaluate(() => {
    (window as Window & { stayed?: boolean }).stayed = true;
  });
  const nav = page.getByTestId('docs-nav');
  await expect(nav.getByRole('link', { name: 'Welcome' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Size and limits' }).click();
  await expect(page).toHaveURL(/\/docs\/size$/);
  await expect(heading(page)).toHaveText('Size and limits');
  await expect(nav.getByRole('link', { name: 'Size and limits' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('link', { name: /^Next/ }).click();
  await expect(page).toHaveURL(/\/docs\/relay$/);
  await page.getByRole('link', { name: /^Previous/ }).click();
  await expect(page).toHaveURL(/\/docs\/size$/);
  await page.goBack();
  await expect(heading(page)).toHaveText('The relay on Cloudflare');

  // A link inside a page, then the header's Guides.
  await page
    .getByTestId('docs-main')
    .getByRole('link', { name: 'Size and limits', exact: true })
    .click();
  await expect(heading(page)).toHaveText('Size and limits');
  await page.getByRole('link', { name: 'Guides' }).click();
  await expect(heading(page)).toHaveText('Learn collaborative Lexical');
  expect(await page.evaluate(() => (window as Window & { stayed?: boolean }).stayed)).toBe(true);
});

test('an unknown docs page goes to the docs home', async ({ page }) => {
  await page.goto('/docs/nope');
  await expect(page).toHaveURL(/\/docs$/);
  await expect(heading(page)).toHaveText('Learn collaborative Lexical');
});

test("the landing page's docs links open the docs", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: "How Lexical's tree lives in Yjs" }).click();
  await expect(page).toHaveURL(/\/docs\/content-in-yjs$/);
  await expect(heading(page)).toHaveText('How content lives in Yjs');
});

test('on a phone, Pages opens the nav', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/quick-start');
  const nav = page.getByTestId('docs-nav');
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Pages' }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Offline and merging' }).click();
  await expect(heading(page)).toHaveText('Offline and merging');
  await expect(nav).toBeHidden();
});

test('the inspector shows the Yjs tree and follows typing', async ({ page }) => {
  await page.goto('/docs/content-in-yjs');
  const tree = page.getByTestId('inspector-tree');
  const editor = page.getByTestId('inspector-editor');
  await expect(tree).toContainText('lexical-y');
  await expect(tree).toContainText('"Agenda" ¶ {t: "heading", p:tag: "h2"}');
  await expect(tree).toContainText('"with demos"{f:bold: true}');

  // Type at the end of the last line, then start a heading with a shortcut.
  const last = editor.locator('p', { hasText: 'Who brings snacks?' });
  const box = (await last.boundingBox())!;
  await last.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.type(' Ana does.');
  await expect(tree).toContainText('"Who brings snacks? Ana does." ¶');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Budget');
  const budget = tree.getByTestId('inspector-row').filter({ hasText: /"Budget/ });
  await expect(budget).toContainText('{t: "heading", p:tag: "h2"}');
  // The caret's line is the highlighted row.
  await expect(budget).toHaveClass(/is-active/);

  // Hovering a row highlights its line, and hovering a line its row.
  const agendaRow = tree.getByTestId('inspector-row').filter({ hasText: '"Agenda"' });
  await agendaRow.hover();
  await expect(agendaRow).toHaveClass(/is-active/);
  await expect(page.locator('.insp-line-hl')).toBeVisible();
  const agendaBox = await editor.getByText('Agenda', { exact: true }).boundingBox();
  const highlight = await page.locator('.insp-line-hl').boundingBox();
  expect(Math.abs((highlight?.y ?? 0) + 2 - (agendaBox?.y ?? 0))).toBeLessThan(8);

  const afternoon = editor.getByText('Afternoon: hack session');
  const afternoonRow = tree
    .getByTestId('inspector-row')
    .filter({ hasText: '"Afternoon: hack session"' });
  await afternoon.hover();
  await expect(afternoonRow).toHaveClass(/is-active/);
  await expect(agendaRow).not.toHaveClass(/is-active/);

  // Typing hands the lead to the caret; the next pointer move, even over the
  // same line, takes it back.
  await page.keyboard.type('!');
  await expect(budget).toHaveClass(/is-active/);
  await expect(afternoonRow).not.toHaveClass(/is-active/);
  const spot = (await afternoon.boundingBox())!;
  await page.mouse.move(spot.x + 6, spot.y + spot.height / 2);
  await expect(afternoonRow).toHaveClass(/is-active/);
  await expect(budget).not.toHaveClass(/is-active/);
});

test('Tab leaves the inspector instead of indenting', async ({ page }) => {
  await page.goto('/docs/content-in-yjs');
  const editor = page.getByTestId('inspector-editor');
  await editor.getByText('Who brings snacks?').click();
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
  await expect(page.getByTestId('inspector-tree')).toContainText('"Who brings snacks?" ¶ {}');
});

test('code in the docs is in Geist Mono, not the system monospace', async ({ page }) => {
  await page.goto('/docs/quick-start');
  const main = page.getByTestId('docs-main');
  await expect(main.locator('pre code').first()).toHaveCSS('font-family', /^"Geist Mono Variable"/);
  await expect(main.locator(':not(pre) > code').first()).toHaveCSS(
    'font-family',
    /^"Geist Mono Variable"/,
  );
});
