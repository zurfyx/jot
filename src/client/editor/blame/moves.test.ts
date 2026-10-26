import { buildEditorFromExtensions } from '@lexical/extension';
import { YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
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
import { mainAuthor, matchLines } from './lines';
import { markMovedLines } from './moves';
import { writeEntry } from './registry';

const nobody = { personId: 'nobody-here', clients: new Set<number>() };

function peer(doc: Y.Doc): LexicalEditor {
  return buildEditorFromExtensions(
    defineExtension({
      name: 'test/peer',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
}

function pair() {
  const anaDoc = new Y.Doc();
  const beaDoc = new Y.Doc();
  anaDoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== beaDoc) Y.applyUpdate(beaDoc, update, anaDoc);
  });
  beaDoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== anaDoc) Y.applyUpdate(anaDoc, update, beaDoc);
  });
  const ana = peer(anaDoc);
  // Bea's editor opens once Ana has written, as a second window would.
  const joinBea = () => peer(beaDoc);
  writeEntry(anaDoc, anaDoc.clientID, {
    personId: 'ana',
    name: 'Ana',
    color: 1,
    kind: 'person',
    seen: 1,
  });
  writeEntry(beaDoc, beaDoc.clientID, {
    personId: 'bea',
    name: 'Bea',
    color: 0,
    kind: 'person',
    seen: 1,
  });
  return { anaDoc, beaDoc, ana, joinBea };
}

const paragraph = (text: string) => $createParagraphNode().append($createTextNode(text));

/** What blame would paint on each of Lexical's lines: its author, or null (unpainted). */
function painted(editor: LexicalEditor, doc: Y.Doc) {
  const lexical = editor.getEditorState().read(() => $lexicalLines());
  const { lines } = computeBlame(doc, nobody);
  const matches = matchLines(
    lexical.map((line) => line.text),
    lines,
  );
  return lexical.map((line, i) => {
    const k = matches[i]!;
    return [line.text, k < 0 ? null : mainAuthor(lines[k]!)];
  });
}

describe('blame and moved lines', () => {
  it('never swaps authors when a peer moves a line with the same text as another', () => {
    const { anaDoc, beaDoc, ana, joinBea } = pair();
    ana.update(() => $getRoot().clear().append(paragraph('Title'), paragraph('same')), {
      discrete: true,
    });
    const bea = joinBea();
    bea.update(() => $getRoot().append(paragraph('same')), { discrete: true });
    expect(painted(bea, beaDoc)).toEqual([
      ['Title', 'ana'],
      ['same', 'ana'],
      ['same', 'bea'],
    ]);

    // Bea moves her line above Ana's: a layout 2 move record.
    bea.update(
      () => {
        const [, anas, beas] = $getRoot().getChildren();
        anas!.insertBefore(beas!);
      },
      { discrete: true },
    );
    expect(beaDoc.get('lexical-y').toString()).toContain('↷');
    // Lexical now shows Bea's "same" first. Blame can't tell the two apart
    // safely, so it paints neither, rather than the wrong person.
    for (const [editor, doc] of [
      [bea, beaDoc],
      [ana, anaDoc],
    ] as const) {
      expect(painted(editor, doc)).toEqual([
        ['Title', 'ana'],
        ['same', null],
        ['same', null],
      ]);
    }
  });

  it('skips a joined line made of pieces from a moved range', () => {
    const { beaDoc, ana, joinBea } = pair();
    ana.update(
      () =>
        $getRoot()
          .clear()
          .append(paragraph('one'), paragraph('two'), paragraph('three'), paragraph('four')),
      { discrete: true },
    );
    const bea = joinBea();
    // Bea moves "four" up under "one"...
    bea.update(
      () => {
        const [, two, , four] = $getRoot().getChildren();
        two!.insertBefore(four!);
      },
      { discrete: true },
    );
    // ...then joins it onto "one" (Backspace at its start).
    bea.update(
      () => {
        const four = $getRoot().getChildren()[1]!;
        if ($isElementNode(four)) {
          four.selectStart().deleteCharacter(true);
        }
      },
      { discrete: true },
    );
    expect(beaDoc.get('lexical-y').toString()).toContain('j=1');
    expect(painted(bea, beaDoc)).toEqual([
      ['onefour', null],
      ['two', 'ana'],
      ['three', 'ana'],
    ]);
  });

  it('keeps painting lines no move touches', () => {
    const { beaDoc, ana, joinBea } = pair();
    ana.update(
      () => $getRoot().clear().append(paragraph('alpha'), paragraph('beta'), paragraph('gamma')),
      { discrete: true },
    );
    const bea = joinBea();
    bea.update(() => $getRoot().append(paragraph('delta')), { discrete: true });
    bea.update(
      () => {
        const [alpha, , , delta] = $getRoot().getChildren();
        alpha!.insertBefore(delta!);
      },
      { discrete: true },
    );
    expect(painted(bea, beaDoc)).toEqual([
      ['delta', null],
      ['alpha', 'ana'],
      ['beta', 'ana'],
      ['gamma', 'ana'],
    ]);
  });
});

describe('markMovedLines', () => {
  it('marks every line when its walk disagrees with the delta', () => {
    const doc = new Y.Doc();
    const editor = peer(doc);
    editor.update(() => $getRoot().clear().append(paragraph('a'), paragraph('b')), {
      discrete: true,
    });
    const lines = [
      { text: 'a', runs: [], readable: true },
      { text: 'not b', runs: [], readable: true },
    ];
    markMovedLines(doc, doc.get('lexical-y'), lines);
    expect(lines.map((line) => line.readable)).toEqual([false, false]);
  });
});
