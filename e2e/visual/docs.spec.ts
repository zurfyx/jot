import { DOCS_PAGES, docsPath } from '../../src/client/docs/pages';
import {
  GERARD,
  asPerson,
  expect,
  isPhone,
  rest,
  shoot,
  shootElement,
  shootTall,
  test,
} from './setup';

/** Every docs page, the phone's page list, and the live inspector. */

for (const { slug, title } of DOCS_PAGES) {
  test(`the docs page ${title}`, async ({ page }) => {
    // Wait for every snippet and lazy part, so the page has its full height.
    await page.goto(docsPath(slug), { waitUntil: 'networkidle' });
    await expect(page.getByTestId('docs-main').getByRole('heading', { level: 1 })).toBeVisible();
    await rest(page);
    await shootTall(page, `docs-${slug || 'home'}`);
  });
}

test('the docs page list on a phone', async ({ page }) => {
  test.skip(!isPhone(page), 'The page list is a phone layout.');
  await page.goto('/docs/quick-start');
  await page.getByRole('button', { name: 'Pages' }).click();
  await expect(page.getByTestId('docs-nav')).toBeVisible();
  await rest(page);
  await shoot(page, 'docs-pages-open');
});

test('the inspector, following a hovered line', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await context.newPage();
  await page.goto('/docs/content-in-yjs');
  const tree = page.getByTestId('inspector-tree');
  await expect(tree).toContainText('lexical-y');
  const row = tree.getByTestId('inspector-row').filter({ hasText: '"Agenda"' });
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await expect(row).toHaveAttribute('data-active', 'true');
  await shoot(page, 'docs-inspector');
});

test('the inspector with a typed quote and code block', async ({ context }) => {
  await asPerson(context, GERARD);
  const page = await context.newPage();
  await page.goto('/docs/content-in-yjs');
  const editor = page.getByTestId('inspector-editor');
  await expect(page.getByTestId('inspector-tree')).toContainText('lexical-y');
  // Quotes and code blocks take the inspector's own size at every width.
  const last = editor.getByText('Who brings snacks?');
  const box = (await last.boundingBox())!;
  await last.click({ position: { x: box.width - 2, y: box.height / 2 } });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> Bring a quote');
  await page.keyboard.press('Enter');
  await page.keyboard.type('``` ');
  await page.keyboard.type('const answer = 42;');
  await expect(editor.locator('blockquote')).toHaveText('Bring a quote');
  await expect(editor.locator('code').last()).toHaveText('const answer = 42;');
  await rest(page);
  await shootElement(editor, 'docs-inspector-typed');
});
