import { buildEditorFromExtensions } from '@lexical/extension';
import { $createListItemNode, $createListNode, $isListNode, type ListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { $createTableNodeWithDimensions } from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  defineExtension,
  type ElementNode,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotEditorExtension } from '../extensions';
import {
  $blocksToMarkdown,
  $replaceBlocks,
  $targetBetween,
  buildPrompt,
  cleanReply,
  MAX_REPLY,
} from './markdown';

function createEditor(): LexicalEditor {
  return buildEditorFromExtensions(
    defineExtension({ name: 'test/ai-markdown', dependencies: [jotEditorExtension] }),
  );
}

/** A heading, a paragraph with bold text, a bullet list and an empty paragraph. */
function seed(editor: LexicalEditor) {
  editor.update(
    () => {
      const list = $createListNode('bullet').append(
        $createListItemNode().append($createTextNode('Ship the binding')),
        $createListItemNode().append($createTextNode('Then the playground')),
      );
      $getRoot()
        .clear()
        .append(
          $createHeadingNode('h1').append($createTextNode('Launch plan')),
          $createParagraphNode().append(
            $createTextNode('Notes for '),
            $createTextNode('Thursday').toggleFormat('bold'),
          ),
          list,
          $createParagraphNode(),
        );
    },
    { discrete: true },
  );
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

const children = () => $getRoot().getChildren() as ElementNode[];

describe('Ask AI Markdown', () => {
  it('exports whole blocks: a heading, bold text and a list', () => {
    const editor = createEditor();
    seed(editor);
    editor.getEditorState().read(() => {
      const [heading, paragraph, list] = children();
      expect($blocksToMarkdown([heading!])).toBe('# Launch plan');
      expect($blocksToMarkdown([paragraph!])).toBe('Notes for **Thursday**');
      expect($blocksToMarkdown([list!])).toBe('- Ship the binding\n- Then the playground');
      expect($blocksToMarkdown([heading!, paragraph!])).toBe(
        '# Launch plan\n\nNotes for **Thursday**',
      );
      expect($blocksToMarkdown([children()[3]!])).toBe('');
      expect($blocksToMarkdown([])).toBe('');
    });
  });

  it('targets the block with the caret, or every block the selection touches', () => {
    const editor = createEditor();
    seed(editor);
    const result = update(editor, () => {
      const [heading, paragraph, list] = children();
      // A caret inside a list item targets the whole list.
      const item = (list as ListNode).getLastChildOrThrow<ElementNode>();
      const caret = item.getFirstDescendant()!.selectStart();
      const inList = $targetBetween(caret.anchor, caret.focus);

      // A selection from the paragraph back up to the heading takes both, in order.
      const range = paragraph!.selectEnd();
      range.focus.set(heading!.getFirstDescendant()!.getKey(), 2, 'text');
      const across = $targetBetween(range.anchor, range.focus);
      return {
        inList: inList?.blocks.map((b) => b.getKey()),
        across: across?.blocks.map((b) => b.getKey()),
        problem: across?.problem,
        expected: [list!.getKey(), heading!.getKey(), paragraph!.getKey()],
      };
    });
    expect(result.inList).toEqual([result.expected[0]]);
    expect(result.across).toEqual(result.expected.slice(1));
    expect(result.problem).toBe('none');
  });

  it('refuses tables', () => {
    const editor = createEditor();
    const problem = update(editor, () => {
      const table = $createTableNodeWithDimensions(2, 2, false);
      $getRoot().clear().append($createParagraphNode(), table);
      const caret = table.getFirstDescendant()!.selectStart();
      return $targetBetween(caret.anchor, caret.focus)?.problem;
    });
    expect(problem).toBe('table');
  });

  it('replaces blocks with the parsed Markdown, and leaves them when it holds nothing', () => {
    const editor = createEditor();
    seed(editor);
    const result = update(editor, () => {
      const paragraph = children()[1]!;
      const blank = $replaceBlocks([paragraph], '   ');
      const countAfterBlank = children().length;
      const last = $replaceBlocks([paragraph], '## Agenda\n\n- Demos\n- Lunch with **Ana**');
      return {
        blank,
        countAfterBlank,
        lastIsList: $isListNode(last),
        types: children().map((node) => node.getType()),
        second: children()[1]!.getTextContent(),
        list: $blocksToMarkdown([children()[2]!]),
      };
    });
    expect(result.blank).toBeNull();
    expect(result.countAfterBlank).toBe(4);
    expect(result.lastIsList).toBe(true);
    expect(result.types).toEqual(['heading', 'heading', 'list', 'list', 'paragraph']);
    expect(result.second).toBe('Agenda');
    expect(result.list).toBe('- Demos\n- Lunch with **Ana**');
  });

  it('builds the prompt and cleans the reply', () => {
    expect(buildPrompt('  make it a list ', 'a, b')).toBe(
      'Instruction: make it a list\n\nPassage:\n<<<\na, b\n>>>',
    );
    expect(cleanReply('```markdown\r\n- a\r\n- b\r\n```')).toBe('- a\n- b');
    expect(cleanReply('<<<\n# Title\n>>>')).toBe('# Title');
    expect(cleanReply('  plain  ')).toBe('plain');
    // A fence inside the reply stays.
    expect(cleanReply('Intro\n\n```\ncode\n```')).toBe('Intro\n\n```\ncode\n```');
    expect(cleanReply('x'.repeat(MAX_REPLY + 10))).toHaveLength(MAX_REPLY);
  });
});
