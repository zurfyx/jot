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
import { $isLinkNode } from '@lexical/link';
import { $isTableNode } from '@lexical/table';
import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isRootNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type PointType,
  type TextNode,
} from 'lexical';

import { normalizeLinkUrl } from '../../../shared/links';
import { MARKDOWN_TRANSFORMERS } from '../extensions';
import { $applyTextDiff } from './textDiff';

/**
 * A hard ceiling on the passage, in characters. The real limit is the model's
 * context window, checked with `measureInputUsage()` against `inputQuota`
 * where the browser offers them.
 */
export const MAX_PASSAGE = 12_000;
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
 * The reply as Markdown to write: trimmed, without the passage markers echoed
 * back, and capped. A fence is unwrapped only when it is unambiguously a
 * wrapper: tagged `markdown` or `md`, around the whole reply, with no other
 * fence inside. An untagged fence is a code block, and stays one.
 */
export function cleanReply(reply: string): string {
  let text = reply.replace(/\r\n?/g, '\n').trim();
  const fenced = /^```(?:markdown|md)[ \t]*\n([\s\S]*)\n```$/i.exec(text);
  if (fenced !== null && !/^[ \t]*```/m.test(fenced[1]!)) {
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
  /** Top-level blocks, in order. A caret in a list item takes the whole list. */
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
  // Text points only on text nodes: a block may start or end with a line
  // break (Shift+Enter, a code block's blank line), which takes element points.
  const start = first.getFirstDescendant();
  const end = last.getLastDescendant();
  if ($isTextNode(start)) {
    selection.anchor.set(start.getKey(), 0, 'text');
  } else {
    selection.anchor.set(first.getKey(), 0, 'element');
  }
  if ($isTextNode(end)) {
    selection.focus.set(end.getKey(), end.getTextContentSize(), 'text');
  } else {
    selection.focus.set(last.getKey(), last.getChildrenSize(), 'element');
  }
  return $convertSelectionToMarkdownString(MARKDOWN_TRANSFORMERS, selection).trim();
}

/**
 * A lossless picture of the blocks (every node's JSON: text, formats, styles,
 * alignment, indents), to tell whether anything changed since. Markdown can't:
 * it drops underline, alignment and runs of spaces.
 */
export function $snapshotBlocks(blocks: readonly ElementNode[]): string {
  const walk = (node: LexicalNode): unknown => {
    const json = node.getLatest().exportJSON() as Record<string, unknown>;
    if ($isElementNode(node)) {
      json.children = node.getChildren().map(walk);
    }
    return json;
  };
  return JSON.stringify(blocks.map(walk));
}

/** Links the model wrote keep only http, https and mailto targets; others become their text. */
function $sanitizeLinks(node: LexicalNode): void {
  if (!$isElementNode(node)) {
    return;
  }
  for (const child of node.getChildren()) {
    $sanitizeLinks(child);
  }
  if ($isLinkNode(node)) {
    const url = normalizeLinkUrl(node.getURL());
    if (url === null) {
      for (const child of node.getChildren()) {
        node.insertBefore(child);
      }
      node.remove();
    } else if (url !== node.getURL()) {
      node.setURL(url);
    }
  }
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
    $sanitizeLinks(node);
  }
  if (nodes.length === blocks.length && nodes.every((node, i) => $canRewrite(blocks[i]!, node))) {
    nodes.forEach((node, i) => $rewrite(blocks[i]!, node));
    return blocks[blocks.length - 1] ?? null;
  }
  for (const node of nodes) {
    first.insertBefore(node);
  }
  for (const block of blocks) {
    block.remove();
  }
  return nodes[nodes.length - 1] ?? null;
}

/** A block whose children are all plain text nodes (at least one). */
function plainTextChildren(block: ElementNode): TextNode[] | null {
  const children = block.getChildren();
  if (children.length === 0) {
    return null;
  }
  const texts: TextNode[] = [];
  for (const child of children) {
    if (!$isTextNode(child) || child.getType() !== 'text') {
      return null;
    }
    texts.push(child);
  }
  return texts;
}

/**
 * Whether old block `old` can take parsed block `fresh` in place: the same
 * kind of block (type, and tag where it has one), each holding plain text alone.
 */
function $canRewrite(old: ElementNode, fresh: ElementNode): boolean {
  const tag = (node: ElementNode): unknown =>
    'getTag' in node && typeof node.getTag === 'function' ? node.getTag() : null;
  return (
    old.getType() === fresh.getType() &&
    tag(old) === tag(fresh) &&
    plainTextChildren(old) !== null &&
    plainTextChildren(fresh) !== null
  );
}

/**
 * Writes parsed block `fresh` into old block `old`, which it then equals: the
 * old text nodes take the new text, formats and styles (extra new ones are
 * appended, extra old ones removed). The new text goes in as exact splices,
 * one per changed run of words ($applyTextDiff). Why: @lexical/y keeps the
 * identity of the characters a splice leaves, so blame keeps crediting their
 * writer and a peer's concurrent edit inside them stays where it was made; a
 * text set whole is recorded as before and after only, so the binding guesses
 * one changed stretch from the first change to the last, and a block made
 * again holds only new text, so jot AI would be credited with the whole
 * passage.
 */
function $rewrite(old: ElementNode, fresh: ElementNode): void {
  const olds = plainTextChildren(old)!;
  const freshes = plainTextChildren(fresh)!;
  old.setFormat(fresh.getFormatType());
  old.setIndent(fresh.getIndent());
  freshes.forEach((text, i) => {
    const target = olds[i];
    if (target === undefined) {
      old.append(text);
      return;
    }
    $applyTextDiff(target, text.getTextContent());
    target.setFormat(text.getFormat());
    target.setStyle(text.getStyle());
    target.setDetail(text.getDetail());
    target.setMode(text.getMode());
  });
  for (const extra of olds.slice(freshes.length)) {
    extra.remove();
  }
}
