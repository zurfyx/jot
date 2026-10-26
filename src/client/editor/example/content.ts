/**
 * The example note's content (the offsite plan from the mocks), and how to
 * find its parts again in any editor's state: the demo collaborators' own
 * editors and the page's. Everything here runs inside a Lexical update or
 * read, and finds parts by their text, never by node keys (every editor
 * keys its nodes its own way). A part someone has edited away is not found,
 * and the step that needed it is skipped.
 */
import { $createLinkNode } from '@lexical/link';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNodeWithDimensions,
  $createTableRowNode,
  $isTableNode,
  $isTableRowNode,
  type TableNode,
  type TableRowNode,
  TableCellHeaderStates,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type ParagraphNode,
  type TextNode,
} from 'lexical';

export const EXAMPLE = {
  title: 'Team offsite, May 14',
  intro: ['Plan for the day. Everyone can edit; ', 'share the link', ' to invite.'],
  agendaHeading: 'Agenda',
  /** Ana writes it; jot AI turns it into `agendaItems`. */
  agendaSentence: 'Morning roadmap review and an afternoon hack session.',
  agendaItems: ['Morning: roadmap review', 'Afternoon: hack session'],
  /** "You" type it at the end of the first agenda item, meanwhile. */
  youType: ' with demos',
  todoHeading: 'To do',
  todos: [
    ['Book the room', true],
    ['Order lunch', false],
  ] as const,
  /** Ana adds it during the demo. */
  anaTodo: 'Send the agenda',
  table: [
    ['Who', 'Brings'],
    ['Gerard', 'Laptop'],
  ],
  /** Ana adds it during the demo. */
  anaRow: ['Ana', 'Snacks'],
} as const;

function textOf(node: LexicalNode): string {
  return node.getTextContent().trim();
}

/** True when the note holds nothing: one empty paragraph at most. */
export function $isEmptyNote(): boolean {
  const root = $getRoot();
  const first = root.getFirstChild();
  return (
    root.getChildrenSize() <= 1 &&
    (first === null || $isParagraphNode(first)) &&
    root.getTextContent() === ''
  );
}

/** Replaces the note's content with the example. `link` makes "share the link" a link. */
export function $writeExample(link: string | null): void {
  const root = $getRoot();
  root.clear();

  const title = $createHeadingNode('h1').append($createTextNode(EXAMPLE.title));
  const [before, linked, after] = EXAMPLE.intro;
  const intro = $createParagraphNode().append($createTextNode(before));
  intro.append(
    link === null ? $createTextNode(linked) : $createLinkNode(link).append($createTextNode(linked)),
  );
  intro.append($createTextNode(after));

  const todos = $createListNode('check');
  for (const [text, checked] of EXAMPLE.todos) {
    todos.append($createListItemNode(checked).append($createTextNode(text)));
  }

  const rows = EXAMPLE.table.length;
  const columns = EXAMPLE.table[0].length;
  const table = $createTableNodeWithDimensions(rows, columns, { rows: true, columns: false });
  table.getChildren().forEach((row, r) => {
    if ($isElementNode(row)) {
      row.getChildren().forEach((cell, c) => {
        const paragraph = $isElementNode(cell) ? cell.getFirstChild() : null;
        if ($isElementNode(paragraph)) {
          paragraph.append($createTextNode(EXAMPLE.table[r]?.[c] ?? ''));
        }
      });
    }
  });

  root.append(
    title,
    intro,
    $createHeadingNode('h2').append($createTextNode(EXAMPLE.agendaHeading)),
    $createParagraphNode().append($createTextNode(EXAMPLE.agendaSentence)),
    $createHeadingNode('h2').append($createTextNode(EXAMPLE.todoHeading)),
    todos,
    table,
  );
}

/** The block right after the heading that reads `text`. */
function $afterHeading(text: string): LexicalNode | null {
  for (const child of $getRoot().getChildren()) {
    if ($isHeadingNode(child) && textOf(child) === text) {
      return child.getNextSibling();
    }
  }
  return null;
}

/** The agenda as Ana wrote it: the sentence jot AI turns into a list. */
export function $agendaSentence(): ParagraphNode | null {
  for (const child of $getRoot().getChildren()) {
    if ($isParagraphNode(child) && textOf(child) === EXAMPLE.agendaSentence) {
      return child;
    }
  }
  return null;
}

/** The agenda as a bulleted list, once jot AI has made it one. */
export function $agendaList(): ListNode | null {
  const next = $afterHeading(EXAMPLE.agendaHeading);
  return $isListNode(next) && next.getListType() === 'bullet' ? next : null;
}

/** The agenda list's item that starts with `text`. */
export function $agendaItem(text: string): ListItemNode | null {
  const list = $agendaList();
  if (list === null) {
    return null;
  }
  for (const item of list.getChildren()) {
    if ($isListItemNode(item) && item.getTextContent().startsWith(text)) {
      return item;
    }
  }
  return null;
}

export function $todoList(): ListNode | null {
  const next = $afterHeading(EXAMPLE.todoHeading);
  if ($isListNode(next) && next.getListType() === 'check') {
    return next;
  }
  for (const child of $getRoot().getChildren()) {
    if ($isListNode(child) && child.getListType() === 'check') {
      return child;
    }
  }
  return null;
}

/** The to-do item that reads `text`. */
export function $todoItem(text: string): ListItemNode | null {
  const list = $todoList();
  for (const item of list?.getChildren() ?? []) {
    if ($isListItemNode(item) && textOf(item) === text) {
      return item;
    }
  }
  return null;
}

export function $exampleTable(): TableNode | null {
  for (const child of $getRoot().getChildren()) {
    if ($isTableNode(child)) {
      return child;
    }
  }
  return null;
}

/** The table's row whose first cell reads `text`. */
export function $tableRow(text: string): TableRowNode | null {
  for (const row of $exampleTable()?.getChildren() ?? []) {
    const first = $isTableRowNode(row) ? row.getFirstChild() : null;
    if ($isTableRowNode(row) && first !== null && textOf(first) === text) {
      return row;
    }
  }
  return null;
}

/** Appends an empty row as wide as the table's last one; returns it. */
export function $appendTableRow(table: TableNode): TableRowNode {
  const last = table.getLastChild();
  const columns = $isElementNode(last) ? last.getChildrenSize() : EXAMPLE.table[0].length;
  const row = $createTableRowNode();
  for (let i = 0; i < Math.max(1, columns); i++) {
    row.append(
      $createTableCellNode(TableCellHeaderStates.NO_STATUS).append($createParagraphNode()),
    );
  }
  table.append(row);
  return row;
}

/** The paragraph inside cell `index` of `row`. */
export function $cellParagraph(row: TableRowNode, index: number): ElementNode | null {
  const cell = row.getChildAtIndex(index);
  const paragraph = $isElementNode(cell) ? cell.getFirstChild() : null;
  return $isElementNode(paragraph) ? paragraph : null;
}

/** The last text node inside `element`, if any. */
export function $lastText(element: ElementNode): TextNode | null {
  const last = element.getLastDescendant();
  return $isTextNode(last) ? last : null;
}

/** The agenda as a list: what jot AI writes over the sentence. */
export function $createAgendaList(firstItemOnly: boolean): ListNode {
  const list = $createListNode('bullet');
  const [first, second] = EXAMPLE.agendaItems;
  list.append($createListItemNode().append($createTextNode(first)));
  list.append(
    firstItemOnly ? $createListItemNode() : $createListItemNode().append($createTextNode(second)),
  );
  return list;
}

/** The agenda as a sentence: how Replay demo puts it back. */
export function $createAgendaSentence(): ParagraphNode {
  return $createParagraphNode().append($createTextNode(EXAMPLE.agendaSentence));
}
