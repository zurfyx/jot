import { buildEditorFromExtensions } from '@lexical/extension';
import { $createListItemNode, $createListNode, $isListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  configExtension,
  defineExtension,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotEditorExtension } from '../extensions';
import { computeBlame } from './attribution';
import { $lexicalLines } from './lexical';
import { type BlameLine, linesFromDelta, mainAuthor, matchLines, sharesOf } from './lines';
import { writeEntry } from './registry';

/** A peer: its own Y.Doc and headless editor, synced with the others. */
function peer(doc: Y.Doc): LexicalEditor {
  return buildEditorFromExtensions(
    defineExtension({
      name: 'test/peer',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
}

function link(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== b) Y.applyUpdate(b, update, a);
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== a) Y.applyUpdate(a, update, b);
  });
}

function runs(line: BlameLine): string {
  return line.runs.map((run) => `${run.length}:${run.personId ?? '-'}`).join(' ');
}

/**
 * Ana writes a heading and a list; Bea adds a paragraph with bold text and a
 * line break, and a word inside Ana's list item.
 */
function twoAuthors() {
  const anaDoc = new Y.Doc();
  const beaDoc = new Y.Doc();
  link(anaDoc, beaDoc);
  const ana = peer(anaDoc);
  ana.update(
    () => {
      const root = $getRoot();
      root.clear();
      root.append($createHeadingNode('h1').append($createTextNode('Launch plan')));
      const list = $createListNode('bullet');
      list.append(
        $createListItemNode().append($createTextNode('Ship the binding')),
        $createListItemNode().append($createTextNode('Then the playground')),
      );
      root.append(list);
    },
    { discrete: true },
  );
  writeEntry(anaDoc, anaDoc.clientID, {
    personId: 'ana',
    name: 'Ana',
    color: 1,
    kind: 'person',
    seen: 1,
  });
  const bea = peer(beaDoc);
  bea.update(
    () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode().append(
        $createTextNode('Notes for '),
        $createTextNode('Thursday').toggleFormat('bold'),
        $createLineBreakNode(),
        $createTextNode('sync live'),
      );
      root.getFirstChildOrThrow().insertAfter(paragraph);
    },
    { discrete: true },
  );
  bea.update(
    () => {
      const list = $getRoot().getLastChildOrThrow();
      if ($isListNode(list)) {
        // Typing at the end of Ana's first item.
        const first = list.getFirstChildOrThrow();
        if ($isElementNode(first)) {
          first.selectEnd().insertText(' first');
        }
      }
    },
    { discrete: true },
  );
  writeEntry(beaDoc, beaDoc.clientID, {
    personId: 'bea',
    name: 'Bea',
    color: 0,
    kind: 'person',
    seen: 2,
  });
  return { anaDoc, beaDoc, ana, bea };
}

describe('blame lines from Yjs 14 attributions', () => {
  it('turns a heading, bold text, a line break and a list into lines of runs', () => {
    const { beaDoc } = twoAuthors();
    const { lines } = computeBlame(beaDoc);
    expect(lines.map((line) => line.text)).toEqual([
      'Launch plan',
      'Notes for Thursday\nsync live',
      'Ship the binding first',
      'Then the playground',
    ]);
    expect(lines.every((line) => line.readable)).toBe(true);
    expect(lines.map(runs)).toEqual([
      '11:ana',
      // Bold is a format, not a new run; the line break counts as one.
      '28:bea',
      '16:ana 6:bea',
      '19:ana',
    ]);
  });

  it('matches the lines Lexical renders, in order', () => {
    const { beaDoc, bea } = twoAuthors();
    const lexical = bea.getEditorState().read(() => $lexicalLines());
    const { lines } = computeBlame(beaDoc);
    expect(lexical.map((line) => line.text)).toEqual(lines.map((line) => line.text));
    expect(
      matchLines(
        lexical.map((line) => line.text),
        lines,
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it('counts each person’s share in characters', () => {
    const { anaDoc } = twoAuthors();
    const snapshot = computeBlame(anaDoc);
    expect(snapshot.shares.map(({ person, chars }) => [person.name, chars])).toEqual([
      ['Ana', 46],
      ['Bea', 34],
    ]);
    expect(snapshot.total).toBe(80);
  });

  it('keeps two people who picked the same colour apart', () => {
    const { anaDoc } = twoAuthors();
    writeEntry(anaDoc, 1, { personId: 'ana', name: 'Ana', color: 0, kind: 'person', seen: 9 });
    const snapshot = computeBlame(anaDoc);
    expect(snapshot.shares.map(({ person }) => person.color)).toEqual([0, 1]);
    expect(snapshot.people.get('bea')!.color).toBe(1);
  });

  it('leaves text by clients nobody registered unattributed', () => {
    const doc = new Y.Doc();
    const editor = peer(doc);
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('anonymous')));
      },
      { discrete: true },
    );
    const snapshot = computeBlame(doc);
    expect(snapshot.lines.map(runs)).toEqual(['9:-']);
    expect(snapshot.shares).toEqual([]);
  });
});

describe('linesFromDelta', () => {
  const text = (insert: string, personId?: string) => ({
    type: 'insert',
    insert,
    ...(personId ? { attribution: { insert: [personId] } } : {}),
  });
  const node = (name: string, children: unknown[] = [], attrs: object = {}) => ({
    type: 'insert',
    insert: [{ type: 'delta', name, attrs, children }],
  });

  it('reads lines inside nested blocks, and inline nodes as part of their line', () => {
    const delta = {
      type: 'delta',
      children: [
        text('a', 'p'),
        node('¶'),
        node('b:table', [
          node('b:tablerow', [node('b:tablecell', [text('cell', 'q'), node('¶')])]),
        ]),
        text('x', 'p'),
        node('i:mention', [text('@ana', 'q')]),
        text('y', 'p'),
        node('¶'),
      ],
    };
    const lines = linesFromDelta(delta);
    expect(lines.map((line) => line.text)).toEqual(['a', 'cell', 'x@anay']);
    expect(runs(lines[2]!)).toBe('1:p 4:q 1:p');
  });

  it('marks a line with an embed it cannot measure as unreadable', () => {
    const lines = linesFromDelta({
      type: 'delta',
      children: [text('a'), { type: 'insert', insert: [{ src: 'x.png' }] }, node('¶')],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.readable).toBe(false);
  });

  it('never throws on malformed input', () => {
    for (const value of [null, 1, 'x', [], {}, { children: 'no' }, { children: [null, 3] }]) {
      expect(() => linesFromDelta(value)).not.toThrow();
    }
    const cyclic: { children: unknown[] } = { children: [] };
    cyclic.children.push({ type: 'insert', insert: [{ type: 'delta', name: 'b:x', ...cyclic }] });
    expect(() => linesFromDelta(cyclic)).not.toThrow();
  });
});

describe('matchLines', () => {
  const line = (text: string): BlameLine => ({ text, runs: [], readable: true });

  it('skips lines whose text no blame line has', () => {
    expect(matchLines(['a', 'typed just now', 'b'], [line('a'), line('b')])).toEqual([0, -1, 1]);
  });

  it('finds a block a peer moved, out of storage order', () => {
    expect(matchLines(['b', 'c', 'a'], [line('a'), line('b'), line('c')])).toEqual([1, 2, 0]);
  });

  it('never pairs an unreadable line', () => {
    expect(matchLines(['a'], [{ text: 'a', runs: [], readable: false }])).toEqual([-1]);
  });
});

describe('mainAuthor and sharesOf', () => {
  const blame: BlameLine = {
    text: 'abcdef',
    runs: [
      { length: 2, personId: 'a' },
      { length: 3, personId: 'b' },
      { length: 1, personId: null },
    ],
    readable: true,
  };

  it('picks who wrote most of a line', () => {
    expect(mainAuthor(blame)).toBe('b');
    expect(mainAuthor({ text: '', runs: [], readable: true })).toBeNull();
  });

  it('adds up characters per person', () => {
    expect([...sharesOf([blame, blame])]).toEqual([
      ['a', 4],
      ['b', 6],
    ]);
  });
});
