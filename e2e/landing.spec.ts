import { expect, freshNoteId, test } from './helpers';

test('Start a new note opens /n/<id>', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Write together, live.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new note' }).click();
  await expect(page).toHaveURL(/\/n\/[A-Za-z0-9_-]{21}[AQgw]$/);
  await expect(page.getByTestId('status-pill')).toContainText('Synced');
  await expect(page.getByText('Start writing. Anyone with this link can edit.')).toBeVisible();
});

test('the paste field validates in place', async ({ page }) => {
  await page.goto('/');
  const field = page.getByLabel('Note link or code');
  const open = page.getByRole('button', { name: 'Open', exact: true });
  await expect(open).toBeDisabled();

  await field.fill('hello there');
  await expect(page.getByText("That isn't a note link or code.")).toBeVisible();
  await expect(open).toBeDisabled();

  const id = freshNoteId();
  await field.fill(`https://jot.rovira.sh/n/${id}`);
  await expect(page.getByText(`Opens note ${id.slice(0, 6)}…`)).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(`/n/${id}`);
});

test('a bare code opens its note', async ({ page }) => {
  await page.goto('/');
  const id = freshNoteId();
  await page.getByLabel('Note link or code').fill(id);
  await page.getByLabel('Note link or code').press('Enter');
  await expect(page).toHaveURL(`/n/${id}`);
});

test('the public note is linked', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'public note' }).click();
  await expect(page).toHaveURL('/n/public');
});

test('a malformed note link is a 400', async ({ request }) => {
  const response = await request.get('/n/not-a-note');
  expect(response.status()).toBe(400);
});
