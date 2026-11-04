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
import { $isListItemNode, $isListNode } from '@lexical/list';
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
import { diffWords, type Hunk } from './textDiff';

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
 *
 * Old and new blocks are paired in order, and a pair whose blocks both hold
 * plain text alone is written in place, its kind changed where it must be
 * (`$rewriteInPlace`): the characters the reply keeps keep their identity, so
 * a peer's concurrent edit of them (typing, a deletion, a format) survives,
 * and a second rewrite racing this one merges instead of doubling the text.
 * Other old blocks are replaced, and extra new blocks follow the last one.
 */
export function $replaceBlocks(
  blocks: readonly ElementNode[],
  markdown: string,
): ElementNode | null {
  if (blocks[0] === undefined) {
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
  let last: ElementNode | null = null;
  for (let i = 0; i < nodes.length; i++) {
    const fresh = nodes[i]!;
    const old = blocks[i];
    if (old !== undefined) {
      last = $rewriteInPlace(old, fresh) ?? old.replace(fresh);
    } else if (last !== null) {
      last = last.insertAfter(fresh) as ElementNode;
    }
  }
  for (const block of blocks.slice(nodes.length)) {
    block.remove();
  }
  return last;
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
 * The element of parsed block `fresh` that holds its text, when that is plain
 * text alone: the block itself, or the one item of a one-item list.
 */
function textHolder(fresh: ElementNode): ElementNode | null {
  if (plainTextChildren(fresh) !== null) {
    return fresh;
  }
  const only = fresh.getChildren();
  if ($isListNode(fresh) && only.length === 1 && $isListItemNode(only[0])) {
    return plainTextChildren(only[0]) !== null ? only[0] : null;
  }
  return null;
}

/**
 * Writes parsed block `fresh` into old block `old` without making its text
 * again, when both hold plain text alone; returns the block that now stands
 * where `old` was, or null (and changes nothing) when they don't.
 *
 * Of the same kind (type, and tag where it has one), `old` stays. Of another,
 * `old`'s text nodes move into `fresh` and `fresh` takes `old`'s place, as a
 * Markdown shortcut turns a line into a list item or a heading. Then the text
 * nodes take the reply's text and formats (`$writeRuns`).
 */
function $rewriteInPlace(old: ElementNode, fresh: ElementNode): ElementNode | null {
  const olds = plainTextChildren(old);
  const holder = textHolder(fresh);
  if (olds === null || holder === null) {
    return null;
  }
  const runs = plainTextChildren(holder)!;
  const tag = (node: ElementNode): unknown =>
    'getTag' in node && typeof node.getTag === 'function' ? node.getTag() : null;
  if (holder === fresh && old.getType() === fresh.getType() && tag(old) === tag(fresh)) {
    old.setFormat(fresh.getFormatType());
    old.setIndent(fresh.getIndent());
    $writeRuns(olds, runs);
    return old;
  }
  for (const run of runs) {
    run.remove();
  }
  old.replace(fresh);
  holder.append(...olds);
  $writeRuns(olds, runs);
  return fresh;
}

/**
 * Makes text nodes `olds` (siblings, in order) read as `runs`: the text first,
 * as exact splices, one per changed run of words across the nodes
 * ($applyTextDiff's rule); then the formats, each node split where a run
 * starts or ends and taking that run's format, style, detail and mode. Why:
 * @lexical/y keeps the identity of the characters a splice or a split leaves,
 * so blame keeps crediting their writer and a peer's concurrent edit inside
 * them stays where it was made. Matching nodes by position instead would make
 * a word's new format a new text node holding the rest of the line again.
 */
function $writeRuns(olds: readonly TextNode[], runs: readonly TextNode[]): void {
  const target = runs.map((run) => run.getTextContent()).join('');
  const nodes = [...olds];
  const hunks = diffWords(nodes.map((node) => node.getTextContent()).join(''), target);
  for (let k = hunks.length - 1; k >= 0; k--) {
    $spliceAcross(nodes, hunks[k]!);
  }
  // The text now reads as `target`: split the nodes at each run's edges, then
  // give each piece the format of the run it falls in.
  const edges: number[] = [];
  let length = 0;
  for (const run of runs) {
    length += run.getTextContent().length;
    edges.push(length);
  }
  let start = 0;
  for (let i = 0; i < nodes.length; i++) {
    const size = nodes[i]!.getTextContent().length;
    const cuts = edges
      .filter((edge) => edge > start && edge < start + size)
      .map((edge) => edge - start);
    if (cuts.length > 0) {
      const parts = nodes[i]!.splitText(...cuts);
      nodes.splice(i, 1, ...parts);
      i += parts.length - 1;
    }
    start += size;
  }
  let at = 0;
  for (const node of nodes) {
    const index = edges.findIndex((edge) => edge > at);
    const run = runs[index === -1 ? runs.length - 1 : index]!;
    node.setFormat(run.getFormat());
    node.setStyle(run.getStyle());
    node.setDetail(run.getDetail());
    node.setMode(run.getMode());
    at += node.getTextContent().length;
  }
}

/**
 * Characters `start` to `end` of the nodes' joined text become `text`: the
 * insertion goes into the node where the hunk starts, and each node the hunk
 * covers loses its part (a node left empty is removed, unless it is the last).
 */
function $spliceAcross(nodes: TextNode[], { start, end, text }: Hunk): void {
  // The node that takes the insertion: the one holding `start`, or the last.
  let owner = nodes.length - 1;
  let offset = 0;
  for (let i = 0; i < nodes.length; i++) {
    const length = nodes[i]!.getTextContent().length;
    if (start < offset + length) {
      owner = i;
      break;
    }
    offset += length;
  }
  offset = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const length = node.getTextContent().length;
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + length);
    if (i === owner || from < to) {
      node.spliceText(from - offset, Math.max(0, to - from), i === owner ? text : '', false);
    }
    offset += length;
  }
  for (let i = nodes.length - 1; i >= 0 && nodes.length > 1; i--) {
    if (nodes[i]!.getTextContent() === '') {
      nodes[i]!.remove();
      nodes.splice(i, 1);
    }
  }
}
