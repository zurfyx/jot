import { writeRawNote } from '../raw-client';
import { GERARD, expect, freshNoteId, pageFor, rest, shoot, test } from './setup';

/** The edges: a read-only note and a malformed link. (The full note is in status.spec.ts.) */

test('a read-only note', async ({ context, baseURL }) => {
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => {
    const root = doc.get('lexical-y');
    root.setAttr('lexical-y:99', true);
    root.insert(0, 'From the future');
  });
  const page = await pageFor(context, GERARD);
  await page.goto(`/n/${id}`);
  await expect(page.getByTestId('status-pill')).toHaveText('Read only');
  await rest(page);
  await shoot(page, 'note-read-only');
});

test('a malformed note link', async ({ page }) => {
  const response = await page.goto('/n/not-a-note');
  expect(response?.status()).toBe(400);
  await shoot(page, 'invalid-link');
});

test('an unknown path goes home', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
});
