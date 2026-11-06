import { RichTextExtension } from '@lexical/rich-text';
import { seedYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';

import { SCHEMA_VERSION } from '../../src/shared/schema';
import { writeRawNote } from '../raw-client';
import { GERARD, expect, freshNoteId, pageFor, rest, shoot, test } from './setup';

/**
 * The edges: a read-only note, a malformed link and the 404 page. (The full
 * note is in status.spec.ts.)
 */

test('a read-only note', async ({ context, baseURL }) => {
  const id = freshNoteId();
  // A note a newer jot wrote (D29). One whose layout this release cannot read
  // reloads instead (D34): fence-reload in recovery.spec.ts.
  const written = seedYState(
    { extensions: [RichTextExtension], schemaVersion: SCHEMA_VERSION + 1 },
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('From the future')));
    },
  );
  await writeRawNote(baseURL!, id, (doc) => Y.applyUpdate(doc, written));
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

test('an unknown path is the 404 page', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This page doesn't exist.");
  await rest(page);
  await shoot(page, 'not-found');
});
