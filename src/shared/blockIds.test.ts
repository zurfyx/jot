import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { $getBlockId } from '@lexical/extension';
import { CodeExtension } from '@lexical/code-core';
import { LinkExtension } from '@lexical/link';
import {
  CheckListExtension,
  ListExtension,
  $createListItemNode,
  $createListNode,
} from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, RichTextExtension } from '@lexical/rich-text';
import { TableExtension } from '@lexical/table';
import { createYDoc, YCollabExtension } from '@lexical/y';
import { editYState, readYState, seedYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  configExtension,
  defineExtension,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotNodesExtension } from './nodes';
import { SCHEMA_VERSION } from './schema';

/**
 * Block ids (D38): every block of a note stores an id; a note written before
 * stores none, shows ids derived from its Yjs identity on every client, and
 * stores one on a block's next edit, so two tabs opening it at once agree and
 * nothing is written by opening it.
 */

/** jot's node set as the release before D38 had it: no block ids. */
const previousRelease = defineExtension({
  name: 'jot/nodes-before-block-ids',
  dependencies: [
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    CodeExtension,
    LinkExtension,
    configExtension(TableExtension, { hasCellMerge: false, hasCellBackgroundColor: false }),
  ],
});

const NOW = { extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION, onWarn: null };
const BEFORE = { extensions: [previousRelease], schemaVersion: SCHEMA_VERSION, onWarn: null };

function $build() {
  const root = $getRoot();
  root.append($createHeadingNode('h1').append($createTextNode('Plan')));
  root.append($createParagraphNode().append($createTextNode('First')));
  root.append(
    $createListNode('bullet').append(
      $createListItemNode().append($createTextNode('one')),
      $createListItemNode().append($createTextNode('two')),
    ),
  );
  root.append($createQuoteNode().append($createTextNode('Quoted')));
  root.append($createParagraphNode().append($createTextNode('Last')));
}

/** Every identified block's id, in document order, as `[text, id]`. */
function $ids(): [string, string | null][] {
  const out: [string, string | null][] = [];
  const walk = (node: LexicalNode) => {
    const id = $getBlockId(node);
    if (id !== null) {
      out.push([node.getTextContent().slice(0, 12), id]);
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(walk);
    }
  };
  $getRoot().getChildren().forEach(walk);
  return out;
}

const idsOf = (state: Uint8Array) => readYState(state, NOW, $ids);

/** A page's editor bound to `doc` (synced: it has the note), as the page and the in-tab peers bind. */
function bind(doc: ReturnType<typeof createYDoc>, synced = true) {
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/block-ids',
      dependencies: [
        jotNodesExtension,
        configExtension(YCollabExtension, {
          doc,
          onYStatus: null,
          schemaVersion: SCHEMA_VERSION,
          synced,
        }),
      ],
      onWarn: () => {},
    }),
  );
  const collab = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  return { editor, collab };
}

/** Delivers every update between two documents, both ways, as the relay does. */
function link(a: Y.Doc, b: Y.Doc) {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== b) Y.applyUpdate(b, update, a);
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== a) Y.applyUpdate(a, update, b);
  });
}

describe('a new note (D38)', () => {
  it('stores a unique random id on every block', () => {
    const state = seedYState(NOW, $build);
    const ids = idsOf(state);
    expect(ids.map(([text]) => text)).toEqual([
      'Plan',
      'First',
      'one\n\ntwo',
      'one',
      'two',
      'Quoted',
      'Last',
    ]);
    for (const [, id] of ids) {
      expect(id).toMatch(/^[\w-]{21}$/);
    }
    expect(new Set(ids.map(([, id]) => id)).size).toBe(ids.length);
    // Stored: a reader without the extension sees the same ids.
    expect(readYState(state, BEFORE, $ids)).toEqual(ids);
  });

  it('opened empty by two tabs at once still holds one paragraph, with one id', () => {
    const a = createYDoc();
    const b = createYDoc();
    const pa = bind(a, false);
    const pb = bind(b, false);
    // Both seed before either hears from the other, then sync.
    pa.collab.collab.markSynced();
    pb.collab.collab.markSynced();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const ids = idsOf(Y.encodeStateAsUpdate(a));
    expect(ids).toHaveLength(1);
    expect(idsOf(Y.encodeStateAsUpdate(b))).toEqual(ids);
    expect(pa.editor.read($ids)).toEqual(ids);
    expect(pb.editor.read($ids)).toEqual(ids);
    pa.editor.dispose();
    pb.editor.dispose();
  });
});

describe('a note written before block ids', () => {
  const stored = seedYState(BEFORE, $build);

  it('stores no ids, and shows ids derived from its Yjs identity, the same for every reader', () => {
    expect(readYState(stored, BEFORE, $ids)).toEqual([]);
    const shown = idsOf(stored);
    expect(shown).toHaveLength(7);
    for (const [, id] of shown) {
      expect(id).toMatch(/^y[0-9a-z]+_[0-9a-z]+/);
    }
    expect(new Set(shown.map(([, id]) => id)).size).toBe(shown.length);
    expect(idsOf(stored)).toEqual(shown);
  });

  it('opened by two tabs at once: both show the same ids, and opening writes nothing', () => {
    const a = createYDoc(stored);
    const b = createYDoc(stored);
    let writes = 0;
    a.on('update', () => writes++);
    b.on('update', () => writes++);
    const pa = bind(a);
    const pb = bind(b);
    expect(pa.editor.read($ids)).toEqual(idsOf(stored));
    expect(pb.editor.read($ids)).toEqual(idsOf(stored));
    expect(writes).toBe(0);
    pa.editor.dispose();
    pb.editor.dispose();
  });

  it('stores a block’s shown id on its next edit, and two tabs editing it at once store the same one', () => {
    const shown = idsOf(stored);
    const a = createYDoc(stored);
    const b = createYDoc(stored);
    const pa = bind(a);
    const pb = bind(b);
    // Both type into "First" before either hears from the other.
    const type = (editor: typeof pa.editor, text: string) =>
      editor.update(
        () => {
          const first = $getRoot().getChildAtIndex(1) as ElementNode;
          first.getLastDescendant()!.insertAfter($createTextNode(text));
        },
        { discrete: true },
      );
    type(pa.editor, ' from A');
    type(pb.editor, ' from B');
    link(a, b);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const after = Y.encodeStateAsUpdate(a);
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    // "First" now stores the id it showed; the others still show theirs.
    const storedIds = readYState(after, BEFORE, $ids);
    expect(storedIds).toEqual([[expect.stringContaining('First'), shown[1]![1]]]);
    expect(idsOf(after).map(([, id]) => id)).toEqual(shown.map(([, id]) => id));
    expect(pa.editor.read($ids).map(([, id]) => id)).toEqual(shown.map(([, id]) => id));
    expect(pb.editor.read($ids).map(([, id]) => id)).toEqual(shown.map(([, id]) => id));
    pa.editor.dispose();
    pb.editor.dispose();
  });

  it('migrated in place (D36) keeps every derived id', () => {
    // The layout migration keeps every Yjs id, so derived ids survive; a fresh
    // copy (new items) would change them (migration.test.ts).
    expect(idsOf(stored)).toEqual(idsOf(Y.encodeStateAsUpdate(createYDoc(stored))));
  });
});

describe('a tab of the release before block ids', () => {
  it('keeps the ids it finds when it edits a block', () => {
    const state = seedYState(NOW, $build);
    const before = idsOf(state);
    const { state: edited } = editYState(
      state,
      BEFORE,
      () => {
        const first = $getRoot().getChildAtIndex(1) as ElementNode;
        first.getLastDescendant()!.insertAfter($createTextNode(' edited by an old tab'));
      },
      { writer: null },
    );
    expect(idsOf(edited)).toEqual(
      before.map(([text, id], i) => [i === 1 ? expect.stringContaining('First') : text, id]),
    );
  });
});

describe('what ids cost (D38)', () => {
  it('adds under 50 bytes per block to a new note', () => {
    const measure = (line: (i: number) => string, blocks = 200) => {
      const $many = () => {
        for (let i = 0; i < blocks; i++) {
          $getRoot().append($createParagraphNode().append($createTextNode(line(i))));
        }
      };
      const withIds = seedYState(NOW, $many).byteLength;
      const without = seedYState(BEFORE, $many).byteLength;
      return { without, withIds, perBlock: (withIds - without) / blocks };
    };
    const short = measure((i) => `Line ${i}`);
    const typical = measure(
      (i) => `${i}: ${'a sentence of about eighty characters, as a typical note line holds.'}`,
    );
    console.log('block ids, short lines:', JSON.stringify(short));
    console.log('block ids, 80-character lines:', JSON.stringify(typical));
    for (const { perBlock } of [short, typical]) {
      expect(perBlock).toBeGreaterThan(30);
      expect(perBlock).toBeLessThan(50);
    }
  });
});
