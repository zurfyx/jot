import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, freshNoteId, test } from '../helpers';
import { CLIENT, ORIGIN, serveBuild } from './serve';

/**
 * The code highlighter on the production build (D35): Prism is in a chunk of
 * its own, and a note page loads it only once the note holds a code block.
 */

test.use({ baseURL: ORIGIN });

const assets = readdirSync(join(CLIENT, 'assets'));
const HIGHLIGHT = /^highlight-[\w-]+\.js$/;

test('the highlighter is a chunk of its own, with Prism and its grammars', () => {
  const chunks = assets.filter((file) => HIGHLIGHT.test(file));
  expect(chunks).toHaveLength(1);
  const source = readFileSync(join(CLIENT, 'assets', chunks[0]!), 'utf8');
  // Prism's core, and a grammar of each kind the picker lists.
  expect(source).toContain('languages');
  for (const marker of ['typescript', 'python', 'rust', 'sql']) {
    expect(source, marker).toContain(marker);
  }
  // No other chunk carries Prism.
  for (const file of assets.filter((name) => name.endsWith('.js') && !HIGHLIGHT.test(name))) {
    expect(readFileSync(join(CLIENT, 'assets', file), 'utf8'), file).not.toContain(
      'Prism.languages',
    );
  }
});

test('a note page without code never fetches it', async ({ page }) => {
  await serveBuild(page);
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      scripts.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`/n/${freshNoteId()}`);
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(scripts.some((path) => /\/assets\/NotePage-[\w-]+\.js$/.test(path))).toBe(true);
  expect(scripts.filter((path) => /\/assets\/highlight-/.test(path))).toEqual([]);
});
