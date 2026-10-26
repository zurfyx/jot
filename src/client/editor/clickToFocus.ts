import { $isCodeNode } from '@lexical/code-core';
import { $isQuoteNode } from '@lexical/rich-text';
import { $isTableNode } from '@lexical/table';
import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

/**
 * Presses that keep their own meaning: controls, media, the chrome, menus and
 * dialogs (the ⌘K scrim included), and the banners above the text.
 */
const OWN_PRESSES = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'img',
  'video',
  'iframe',
  '[role="menu"]',
  '[role="dialog"]',
  '.popover',
  '.command-scrim',
  '.dock',
  '.note-chrome',
  '.note-banner',
  '.note-notice',
  '.example-banner',
  '.blame-card',
].join(', ');

/** Open overlays: a press outside one only closes it. */
const OVERLAYS = '.popover, .command-scrim';

/** How far a press may travel and still count as a click, not a drag. */
const CLICK_SLOP_PX = 5;

export interface TextBox {
  left: number;
  right: number;
  top: number;
  /** The bottom of the last block, not of the editor's minimum height. */
  bottom: number;
}

/** Where a press on the blank page puts the caret. */
export type CaretTarget = { kind: 'end' } | { kind: 'point'; x: number; y: number };

/**
 * Below the text, the end of the note; anywhere else (the margins beside a
 * line, the space above the title), the nearest point inside the text.
 */
export function caretTarget(x: number, y: number, text: TextBox | null): CaretTarget {
  if (text === null || y >= text.bottom) {
    return { kind: 'end' };
  }
  return {
    kind: 'point',
    x: clamp(x, text.left + 1, text.right - 1),
    y: clamp(y, text.top + 1, text.bottom - 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function textBox(root: HTMLElement): TextBox | null {
  const last = root.lastElementChild;
  if (last === null) {
    return null;
  }
  const box = root.getBoundingClientRect();
  return {
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: last.getBoundingClientRect().bottom,
  };
}

/** The DOM caret position under a point, if it falls in `root`. */
function caretAt(root: HTMLElement, x: number, y: number): { node: Node; offset: number } | null {
  let point: { node: Node; offset: number } | null = null;
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    point = position && { node: position.offsetNode, offset: position.offset };
  } else if (typeof document.caretRangeFromPoint === 'function') {
    // Safari before caretPositionFromPoint.
    const range = document.caretRangeFromPoint(x, y);
    point = range && { node: range.startContainer, offset: range.startOffset };
  }
  return point !== null && root.contains(point.node) ? point : null;
}

/**
 * Whether writing after `last` needs a new line: a caret can't sit after an
 * image or another decorator, and at the end of a code block, a table or a
 * quote the typing would land inside it.
 */
function $needsLineAfter(last: LexicalNode | null): boolean {
  return (
    last === null ||
    $isDecoratorNode(last) ||
    $isCodeNode(last) ||
    $isTableNode(last) ||
    $isQuoteNode(last)
  );
}

function selectEnd(editor: LexicalEditor): void {
  editor.update(() => {
    const root = $getRoot();
    if ($needsLineAfter(root.getLastChild())) {
      root.append($createParagraphNode());
    }
    root.selectEnd();
  });
}

/**
 * A click on the blank page writes, as in Notion: below the text it puts the
 * caret at the end of the note, beside a line (in the margins) at the nearest
 * point of that line. Controls, menus, links, media, open overlays and
 * selection drags keep their own behaviour, and nothing scrolls. The click
 * listener sits on `page` rather than the document, so iOS Safari sends taps
 * on the blank page to it too.
 */
export function registerClickToFocus(page: HTMLElement, editor: LexicalEditor): () => void {
  let press: { x: number; y: number; overOverlay: boolean } | null = null;

  const onPointerDown = (event: PointerEvent) => {
    press = {
      x: event.clientX,
      y: event.clientY,
      overOverlay: document.querySelector(OVERLAYS) !== null,
    };
  };

  const onClick = (event: MouseEvent) => {
    const start = press;
    press = null;
    const root = editor.getRootElement();
    const target = event.target;
    if (
      root === null ||
      !editor.isEditable() ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.detail > 1 ||
      start === null ||
      start.overOverlay ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX ||
      !(target instanceof Element) ||
      target.closest(OWN_PRESSES) !== null
    ) {
      return;
    }
    const text = textBox(root);
    const goal = caretTarget(event.clientX, event.clientY, text);
    // Inside the editor, the browser already placed the caret, except below
    // the last block (the editor's minimum height), where the end is meant.
    if (root.contains(target) && !(target === root && goal.kind === 'end')) {
      return;
    }
    // A drag that ended on the blank page left a selection: keep it.
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed && root.contains(selection.anchorNode)) {
      return;
    }
    root.focus({ preventScroll: true });
    const point = goal.kind === 'point' ? caretAt(root, goal.x, goal.y) : null;
    if (point === null) {
      selectEnd(editor);
    } else {
      // Lexical follows the DOM selection on selectionchange.
      window.getSelection()?.collapse(point.node, point.offset);
    }
  };

  // On the window in the capture phase, ahead of the popovers' own listener
  // that closes them on the same press.
  window.addEventListener('pointerdown', onPointerDown, true);
  page.addEventListener('click', onClick);
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    page.removeEventListener('click', onClick);
  };
}
