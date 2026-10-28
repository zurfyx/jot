import { buildEditorFromExtensions } from '@lexical/extension';
import { YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { jotEditorExtension } from '../extensions';
import { $replaceBlocks } from './markdown';
import { $applyTextDiff, diffWords, type Hunk } from './textDiff';

/** A small seeded generator (mulberry32), so a failure replays. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'the',
  'plan',
  'Plan',
  'ship',
  'binding',
  'día',
  'naïve',
  '42',
  'snake_case',
  '😀',
  '👩🏽‍💻',
  ',',
  '.',
  '!',
  '—',
  "'",
  '(',
  ')',
  '',
];
const GAPS = [' ', ' ', ' ', '  ', '\t', ''];

function sentence(next: () => number): string {
  const length = Math.floor(next() * 14);
  let text = '';
  for (let i = 0; i < length; i++) {
    text += PIECES[Math.floor(next() * PIECES.length)]! + GAPS[Math.floor(next() * GAPS.length)]!;
  }
  return text;
}

/** `before` edited a little: words swapped, dropped, added, so most survive. */
function edited(before: string, next: () => number): string {
  const tokens = before.split(/(\s+)/);
  const out: string[] = [];
  for (const token of tokens) {
    const roll = next();
    if (roll < 0.1) {
      continue;
    }
    if (roll < 0.25) {
      out.push(PIECES[Math.floor(next() * PIECES.length)]!);
    } else {
      out.push(token);
    }
    if (next() < 0.1) {
      out.push(' ' + sentence(next));
    }
  }
  return out.join('');
}

function applyHunks(before: string, hunks: readonly Hunk[]): string {
  let text = before;
  for (let k = hunks.length - 1; k >= 0; k--) {
    const { start, end, text: inserted } = hunks[k]!;
    text = text.slice(0, start) + inserted + text.slice(end);
  }
  return text;
}

/** Runs `fn` in a discrete update and returns its result (assert outside: Lexical catches throws). */
function update<T>(editor: LexicalEditor, fn: () => T): T {
  let result: { value: T } | null = null;
  editor.update(
    () => {
      result = { value: fn() };
    },
    { discrete: true },
  );
  if (result === null) {
    throw new Error('the update did not run');
  }
  return (result as { value: T }).value;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** An editor bound to its own Yjs document, as the page and jot AI each have. */
function createClient(name: string, from?: Y.Doc) {
  const doc = new Y.Doc();
  if (from !== undefined) {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  }
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: `test/text-diff-${name}`,
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  cleanups.push(() => {
    editor.dispose();
    doc.destroy();
  });
  return { doc, editor };
}

function plainEditor(): LexicalEditor {
  const editor = buildEditorFromExtensions(
    defineExtension({ name: 'test/text-diff', dependencies: [jotEditorExtension] }),
  );
  cleanups.push(() => editor.dispose());
  return editor;
}

const firstText = () => ($getRoot().getFirstChild() as ElementNode).getFirstChild() as TextNode;
const rootText = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

/** Exchanges what each document is missing, both ways. */
function sync(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

/** Characters `client` inserted that the document still holds. */
function liveInserts(doc: Y.Doc, client: number): number {
  let count = 0;
  Y.createInsertSetFromStructStore(doc.store, true).forEach((range, id) => {
    if (id === client) {
      count += range.len;
    }
  });
  return count;
}

describe('diffWords', () => {
  it('turns any text into any other, with ordered hunks apart', () => {
    const next = random(20261027);
    for (let round = 0; round < 2000; round++) {
      const before = sentence(next);
      const after = next() < 0.7 ? edited(before, next) : sentence(next);
      const hunks = diffWords(before, after);
      expect(applyHunks(before, hunks), JSON.stringify({ before, after })).toBe(after);
      for (let k = 0; k < hunks.length; k++) {
        const { start, end, text } = hunks[k]!;
        expect(start <= end && (end > start || text !== '')).toBe(true);
        if (k > 0) {
          expect(start).toBeGreaterThan(hunks[k - 1]!.end);
        }
      }
    }
  });

  it('changes whole words, and leaves the rest alone', () => {
    expect(diffWords('alpha beta gamma', 'alpha beta gamma')).toEqual([]);
    expect(diffWords('alpha beta gamma', 'ALPHA beta GAMMA')).toEqual([
      { start: 0, end: 5, text: 'ALPHA' },
      { start: 11, end: 16, text: 'GAMMA' },
    ]);
    expect(diffWords('Demos, lunch, hack session', 'Demos, lunch and a hack session')).toEqual([
      { start: 12, end: 13, text: ' and a' },
    ]);
    expect(diffWords('', 'new text')).toEqual([{ start: 0, end: 0, text: 'new text' }]);
    expect(diffWords('old text', '')).toEqual([{ start: 0, end: 8, text: '' }]);
  });

  it('never splits a character made of several code units', () => {
    const before = 'a 👩🏽‍💻 b';
    const hunks = diffWords(before, 'a 👩🏽‍🎨 b');
    // A boundary between a high and a low surrogate would split a character.
    const splits = (at: number) => /[\uD800-\uDBFF]/.test(before.charAt(at - 1));
    expect(hunks.length).toBeGreaterThan(0);
    for (const { start, end } of hunks) {
      expect(splits(start) || splits(end)).toBe(false);
    }
    expect(applyHunks(before, hunks)).toBe('a 👩🏽‍🎨 b');
  });
});

describe('$applyTextDiff', () => {
  it('sets the text node to the target for random pairs', () => {
    const editor = plainEditor();
    const next = random(7);
    for (let round = 0; round < 300; round++) {
      const before = sentence(next) || 'x';
      const after = (next() < 0.7 ? edited(before, next) : sentence(next)) || 'y';
      const result = update(editor, () => {
        const node = $createTextNode(before);
        $getRoot().clear().append($createParagraphNode().append(node));
        const key = node.getKey();
        $applyTextDiff(node, after);
        return { text: node.getTextContent(), same: firstText().getKey() === key };
      });
      expect(result.text, JSON.stringify({ before, after })).toBe(after);
      expect(result.same).toBe(true);
    }
  });

  it('keeps the identity of untouched words under @lexical/y', () => {
    const page = createClient('page');
    update(page.editor, () =>
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('alpha beta gamma delta'))),
    );
    const ai = createClient('ai', page.doc);
    const key = update(ai.editor, () => {
      const node = firstText();
      $applyTextDiff(node, 'ALPHA beta gamma DELTA');
      return node.getKey();
    });
    expect(update(ai.editor, () => firstText().getKey())).toBe(key);
    sync(page.doc, ai.doc);
    expect(rootText(page.editor)).toBe('ALPHA beta gamma DELTA');
    // jot AI's client holds the two words it wrote, and nothing else: " beta
    // gamma " is still the page's.
    expect(liveInserts(page.doc, ai.doc.clientID)).toBe('ALPHA'.length + 'DELTA'.length);
  });
});

describe('a rewrite racing a peer', () => {
  it("keeps the peer's typing inside a word the rewrite kept, where it was typed", () => {
    const page = createClient('page');
    update(page.editor, () =>
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('alpha beta gamma'))),
    );
    const ai = createClient('ai', page.doc);
    expect(rootText(ai.editor)).toBe('alpha beta gamma');

    // At once: the page types "X" inside "beta", jot AI rewrites the block
    // around it.
    update(page.editor, () => {
      firstText().spliceText('alpha be'.length, 0, 'X', false);
    });
    update(ai.editor, () => {
      $replaceBlocks([$getRoot().getFirstChild() as ElementNode], 'ALPHA beta GAMMA');
    });
    expect(rootText(page.editor)).toBe('alpha beXta gamma');
    expect(rootText(ai.editor)).toBe('ALPHA beta GAMMA');

    sync(page.doc, ai.doc);
    expect(rootText(page.editor)).toBe('ALPHA beXta GAMMA');
    expect(rootText(ai.editor)).toBe('ALPHA beXta GAMMA');
  });
});
