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

test('a malformed note link is a 400', async ({ request }) => {
  const response = await request.get('/n/not-a-note');
  expect(response.status()).toBe(400);
});

test('there is no public note', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Write together, live.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'public note' })).toHaveCount(0);
  const response = await request.get('/n/public');
  expect(response.status()).toBe(400);
});

test('notes stay out of search engines and the landing page does not', async ({ request }) => {
  const note = await request.get(`/n/${freshNoteId()}`);
  expect(note.status()).toBe(200);
  expect(note.headers()['x-robots-tag']).toBe('noindex, nofollow');

  const landing = await request.get('/');
  expect(landing.headers()['x-robots-tag']).toBeUndefined();

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const lines = (await robots.text()).split('\n');
  expect(lines).toEqual(
    expect.arrayContaining(['User-agent: *', 'Disallow: /n/', 'Disallow: /api/']),
  );
});
