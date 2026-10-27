import { DOCS_PAGES, docsPath } from '../../src/client/docs/pages';
import { GERARD, asPerson, expect, isPhone, rest, shoot, shootTall, test } from './setup';

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
  await expect(row).toHaveClass(/is-active/);
  await shoot(page, 'docs-inspector');
});
