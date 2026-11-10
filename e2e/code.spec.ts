import { $createCodeNode } from '@lexical/code-core';
import { seedYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import type { Page } from '@playwright/test';

import { jotNodesExtension } from '../src/shared/nodes';
import { SCHEMA_VERSION } from '../src/shared/schema';
import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { writeRawNote } from './raw-client';

// Code blocks (D35): the highlighter is fetched the first time a note holds a
// code block, and its tokens are stored, so every client shows the same.
// Two pages in one context: each page is its own Yjs client.

/** Records whether `page` has asked for the highlighter's module: its own file in the dev server. */
function watchHighlighter(page: Page): () => boolean {
  let requested = false;
  page.on('request', (request) => {
    if (/code-prism|\/editor\/code\/highlight\b|prismjs/.test(request.url())) {
      requested = true;
    }
  });
  return () => requested;
}

const code = (page: Page) => editor(page).locator('code.jot-codeblock');
const token = (page: Page, kind: string) => code(page).locator(`.jot-token-${kind}`);

test('a code block highlights as you type, and a second page converges', async ({ context }) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  const aLoaded = watchHighlighter(a);
  await openNote(a, id);
  await openNote(b, id);

  await editor(a).click();
  await a.keyboard.type('Snippets');
  await a.keyboard.press('Enter');
  await a.keyboard.type('No code yet.');
  await expect(editor(b)).toContainText('No code yet.');
  // A note without a code block never fetches the highlighter.
  expect(aLoaded()).toBe(false);

  await a.keyboard.press('Enter');
  await a.keyboard.type('```ts ');
  // The first code block fetches the highlighter. Code typed before it
  // arrives is highlighted with the next keystroke in the block.
  await expect.poll(aLoaded).toBe(true);
  await expect(code(a)).toHaveAttribute('data-gutter', '1');
  await a.keyboard.type('const answer = 42; // why');
  await expect(token(a, 'keyword')).toHaveText(['const']);
  await expect(token(a, 'number')).toHaveText(['42']);
  await expect(token(a, 'comment')).toHaveText(['// why']);
  await expect(code(a)).toHaveAttribute('data-language', 'ts');

  // The other page shows the same code with the same tokens.
  await expect(code(b)).toHaveText('const answer = 42; // why');
  await expect(token(b, 'keyword')).toHaveText(['const']);
  await expect(token(b, 'comment')).toHaveText(['// why']);

  // B types a second line; A sees it highlighted.
  await code(b).click();
  await b.keyboard.press('ControlOrMeta+End');
  await b.keyboard.press('Enter');
  await b.keyboard.type('let name = "jot";');
  await expect(token(a, 'string')).toHaveText(['"jot"']);
  await expect(token(a, 'keyword')).toHaveText(['const', 'let']);

  // Both type into the block at once: they converge on one text and one set of tokens.
  await code(a).click();
  await a.keyboard.press('ControlOrMeta+End');
  await Promise.all([a.keyboard.type(' // a'), b.keyboard.type(' // b')]);
  const shown = async (page: Page) =>
    JSON.stringify([
      await code(page).innerText(),
      await code(page)
        .locator('[class*="jot-token-"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => [node.className.split(' ')[0], node.textContent]),
        ),
    ]);
  await expect.poll(async () => (await shown(a)) === (await shown(b))).toBe(true);
  await expect(code(a)).toContainText('// a');
  await expect(code(a)).toContainText('// b');

  // The language picker: Plain text takes the colours away on both pages.
  await code(a).click();
  const picker = a.getByRole('combobox', { name: 'Code language' });
  await expect(picker).toHaveValue('typescript');
  await picker.selectOption('plain');
  await expect(code(b)).toHaveAttribute('data-language', 'plain');
  await expect(token(a, 'keyword')).toHaveCount(0);
  await expect(token(b, 'keyword')).toHaveCount(0);
  // And Python brings them back, as Python: `//` starts no comment there.
  await picker.selectOption('py');
  await expect(code(b)).toHaveAttribute('data-language', 'py');
  await expect(token(b, 'string')).toHaveText(['"jot"']);
  await expect(token(b, 'comment')).toHaveCount(0);
  // The caret left the block: the picker goes.
  await editor(a).getByText('No code yet.').click();
  await expect(picker).toHaveCount(0);
});

test('a note that opens with a code block fetches the highlighter', async ({ page, baseURL }) => {
  const id = freshNoteId();
  // Code stored as plain text, as a jot without the highlighter wrote it.
  const written = seedYState(
    { extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION },
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Stored code')),
        $createCodeNode('js').append($createTextNode('function hello() { return "hi"; }')),
      );
    },
  );
  await writeRawNote(baseURL!, id, (doc) => Y.applyUpdate(doc, written));
  const loaded = watchHighlighter(page);
  await openNote(page, id);
  await expect.poll(loaded).toBe(true);
  await expect(code(page)).toHaveAttribute('data-gutter', '1');
  // The tokens are part of the note: opening it writes none (no one edited
  // it), so the block shows as stored until someone edits it.
  await expect(token(page, 'keyword')).toHaveCount(0);
  await code(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  await expect(token(page, 'keyword')).toHaveText(['function', 'return']);
  await expect(token(page, 'function')).toHaveText(['hello']);
  await expect(token(page, 'string')).toHaveText(['"hi"']);
});
