import { buildEditorFromExtensions } from '@lexical/extension';
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { $createTableNodeWithDimensions } from '@lexical/table';
import { YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotEditorExtension } from '../editor/extensions';
import { lineKeys } from './lines';
import { printValue, readRows, type Row, rowsFromDelta, visibleText } from './yjsTree';

function bound() {
  const doc = new Y.Doc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/inspector',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
      onWarn: () => {},
    }),
  );
  return { doc, editor };
}

const lines = (rows: Row[]) => rows.filter((row) => row.kind === 'line');

describe("the inspector's rows", () => {
  it('reads the root attributes, lines, markers, formats and groups', () => {
    const { doc, editor } = bound();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createHeadingNode('h2').append($createTextNode('Agenda')));
        const list = $createListNode('bullet');
        list.append(
          $createListItemNode().append(
            $createTextNode('Morning '),
            $createTextNode('with demos').toggleFormat('bold'),
          ),
          $createListItemNode().append(
            $createTextNode('See '),
            $createLinkNode('https://lexical.dev').append($createTextNode('the docs')),
          ),
        );
        root.append(list);
        root.append(
          $createParagraphNode().append(
            $createTextNode('one'),
            $createLineBreakNode(),
            $createTextNode('two'),
          ),
        );
      },
      { discrete: true },
    );

    const rows = readRows(doc);
    const root = rows[0];
    expect(root?.kind).toBe('root');
    expect(root?.kind === 'root' && root.attrs).toEqual(
      expect.arrayContaining([
        { key: 'lexical-y', value: '1' },
        { key: 'k:heading', value: '"line"' },
        { key: 'k:list', value: '"group|listType"' },
      ]),
    );

    const [heading, morning, link, paragraph] = lines(rows);
    expect(heading).toMatchObject({
      text: 'Agenda',
      line: 0,
      marker: [
        { key: 't', value: '"heading"' },
        { key: 'p:tag', value: '"h2"' },
      ],
    });
    expect(morning).toMatchObject({
      text: 'Morning with demos',
      segments: [
        { text: 'Morning ', attrs: [] },
        { text: 'with demos', attrs: [{ key: 'f:bold', value: 'true' }] },
      ],
    });
    expect(morning?.kind === 'line' && morning.marker).toEqual(
      expect.arrayContaining([
        { key: 'g', value: '"list"' },
        { key: 'g:listType', value: '"bullet"' },
        { key: 'l', value: '0' },
      ]),
    );
    expect(link?.kind === 'line' && link.segments[1]).toMatchObject({
      text: 'the docs',
      attrs: [{ key: 'w:link', value: expect.stringContaining('https://lexical.dev') }],
    });
    // A paragraph's marker has no type.
    expect(paragraph).toMatchObject({ text: 'one\ntwo', marker: [] });
    expect(visibleText('one\ntwo\tx')).toBe('one↵two⇥x');
  });

  it('nests tables as nodes, and pairs every line with a Lexical line element', () => {
    const { doc, editor } = bound();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode().append($createTextNode('Before')));
        root.append($createTableNodeWithDimensions(2, 2, false));
        const nested = $createListNode('number');
        const outer = $createListItemNode().append($createTextNode('Outer'));
        const inner = $createListItemNode().append(
          $createListNode('number').append($createListItemNode().append($createTextNode('Inner'))),
        );
        nested.append(outer, inner);
        root.append(nested);
      },
      { discrete: true },
    );

    const rows = readRows(doc);
    const nodes = rows
      .filter((row) => row.kind === 'node')
      .map((row) => row.kind === 'node' && row.name);
    expect(nodes).toEqual([
      'b:table',
      'b:tablerow',
      'b:tablecell',
      'b:tablecell',
      'b:tablerow',
      'b:tablecell',
      'b:tablecell',
    ]);
    const cell = rows.find((row) => row.kind === 'node' && row.name === 'b:tablecell');
    expect(cell?.depth).toBe(3);

    const yLines = lines(rows);
    const lexicalLines = lineKeys(editor);
    expect(yLines.map((row) => row.kind === 'line' && row.text)).toEqual(
      lexicalLines.map((line) => line.text),
    );
    expect(yLines.map((row) => row.kind === 'line' && row.text)).toEqual([
      'Before',
      '',
      '',
      '',
      '',
      'Outer',
      'Inner',
    ]);
    // The nested item carries its level.
    const innerRow = yLines[6];
    expect(innerRow?.kind === 'line' && innerRow.marker).toEqual(
      expect.arrayContaining([{ key: 'l', value: '1' }]),
    );
  });

  it('survives unexpected input', () => {
    expect(rowsFromDelta(null)).toEqual([{ kind: 'root', depth: 0, name: 'lexical-y', attrs: [] }]);
    expect(
      rowsFromDelta({ children: [{ type: 'retain', retain: 3 }, { insert: 'loose' }, 7] }),
    ).toMatchObject([{ kind: 'root' }, { kind: 'run', text: 'loose' }]);
    expect(printValue('\u0000{"a":1}')).toBe('{"a":1}');
    expect(printValue(3)).toBe('3');
  });
});
