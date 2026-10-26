/**
 * What jot AI reads and writes: the target blocks of a request as Markdown,
 * the prompt, the reply cleaned up, and the blocks replaced with the parsed
 * reply. The Lexical functions run inside an editor read or update; the
 * page's editor and jot AI's own editor both use them, on the same blocks
 * (found through a Yjs cursor, so in each editor's own node keys).
 */
import {
  $convertSelectionToMarkdownString,
  $generateNodesFromMarkdownString,
} from '@lexical/markdown';
import { $isTableNode } from '@lexical/table';
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isRootNode,
  type ElementNode,
  type LexicalNode,
  type PointType,
} from 'lexical';

import { MARKDOWN_TRANSFORMERS } from '../extensions';

/** The longest passage sent to the model, in characters (Gemini Nano's context is small). */
export const MAX_PASSAGE = 6000;
/** The longest reply written into the note, in characters (the note's 2 MB counts). */
export const MAX_REPLY = 20_000;

export const SYSTEM_PROMPT = [
  'You are jot AI, an editor inside a shared notes app.',
  'You get an instruction and a passage of Markdown from the note.',
  'Reply with only the new passage, in Markdown: no preamble, no explanation, no code fence around the reply.',
  'Use paragraphs, headings (#, ##, ###), bullet lists (-), numbered lists (1.), to-dos (- [ ] and - [x]),',
  'quotes (>), **bold**, *italic*, `code` and [links](https://example.com). No tables, no images.',
  'If the passage is empty, write new text that follows the instruction.',
].join(' ');

/** The user's turn: the instruction, then the passage between markers. */
export function buildPrompt(instruction: string, markdown: string): string {
  return `Instruction: ${instruction.trim()}\n\nPassage:\n<<<\n${markdown}\n>>>`;
}

/**
 * The reply as Markdown to write: trimmed, without a code fence wrapping the
 * whole reply or the passage markers echoed back, and capped.
 */
export function cleanReply(reply: string): string {
  let text = reply.replace(/\r\n?/g, '\n').trim();
  const fenced = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced !== null) {
    text = fenced[1]!.trim();
  }
  text = text
    .replace(/^<<<\n?/, '')
    .replace(/\n?>>>$/, '')
    .trim();
  return text.slice(0, MAX_REPLY);
}

export type TargetProblem = 'none' | 'table';

export interface Target {
  /** Top-level blocks, in order. */
  blocks: ElementNode[];
  /** Why jot AI can't rewrite them, or 'none'. */
  problem: TargetProblem;
}

function $topLevelOf(point: PointType): LexicalNode | null {
  const node = point.getNode();
  if ($isRootNode(node)) {
    const children = node.getChildren();
    return children[Math.min(point.offset, children.length - 1)] ?? null;
  }
  // Not getTopLevelElement: it stops at shadow roots such as table cells.
  let current: LexicalNode | null = node;
  while (current !== null && !$isRootNode(current.getParent())) {
    current = current.getParent();
  }
  return current;
}

/**
 * The top-level blocks from `anchor` to `focus` (either order): the selected
 * blocks, or the block with the caret. Null when the points are not in the
 * note.
 */
export function $targetBetween(anchor: PointType, focus: PointType): Target | null {
  const a = $topLevelOf(anchor);
  const b = $topLevelOf(focus);
  if (a === null || b === null) {
    return null;
  }
  const children = $getRoot().getChildren();
  const i = children.findIndex((child) => child.is(a));
  const j = children.findIndex((child) => child.is(b));
  if (i < 0 || j < 0) {
    return null;
  }
  const picked = children.slice(Math.min(i, j), Math.max(i, j) + 1);
  const blocks = picked.filter($isElementNode);
  const problem: TargetProblem =
    blocks.length !== picked.length || blocks.some((block) => $isTableNode(block))
      ? 'table'
      : 'none';
  return { blocks, problem };
}

/** The blocks as Markdown, whole (the selection inside them doesn't matter). */
export function $blocksToMarkdown(blocks: readonly ElementNode[]): string {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (first === undefined || last === undefined) {
    return '';
  }
  // A selection over the blocks, start to end, only to export them: it is
  // never set on the editor.
  const selection = $createRangeSelection();
  const start = first.getFirstDescendant();
  const end = last.getLastDescendant();
  if (start !== null && end !== null && !$isElementNode(start) && !$isElementNode(end)) {
    selection.anchor.set(start.getKey(), 0, 'text');
    selection.focus.set(end.getKey(), end.getTextContentSize(), 'text');
  } else {
    selection.anchor.set(first.getKey(), 0, 'element');
    selection.focus.set(last.getKey(), last.getChildrenSize(), 'element');
  }
  return $convertSelectionToMarkdownString(MARKDOWN_TRANSFORMERS, selection).trim();
}

/**
 * Replaces `blocks` with the blocks parsed from `markdown`. Returns the last
 * new block, or null (and changes nothing) when the Markdown holds nothing.
 */
export function $replaceBlocks(
  blocks: readonly ElementNode[],
  markdown: string,
): ElementNode | null {
  const first = blocks[0];
  if (first === undefined) {
    return null;
  }
  const parsed = $generateNodesFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS);
  const nodes: ElementNode[] = [];
  for (const node of parsed) {
    if ($isElementNode(node) && !node.isInline()) {
      nodes.push(node);
    } else {
      // Top-level text, should the parser leave any, goes in a paragraph.
      const previous = nodes[nodes.length - 1];
      if (previous !== undefined && previous.getType() === 'paragraph') {
        previous.append(node);
      } else {
        nodes.push($createParagraphNode().append(node));
      }
    }
  }
  if (nodes.length === 0 || nodes.every((node) => node.getTextContent().trim() === '')) {
    return null;
  }
  for (const node of nodes) {
    first.insertBefore(node);
  }
  for (const block of blocks) {
    block.remove();
  }
  return nodes[nodes.length - 1] ?? null;
}
