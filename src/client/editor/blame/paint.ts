/**
 * Painting blame without touching Lexical's DOM: underlines through the CSS
 * Custom Highlight API, from Ranges over the editor's text nodes. Lines are
 * matched to Lexical's line elements; a line whose text does not match its
 * element is skipped. Nothing here throws.
 */
import type { LexicalEditor } from 'lexical';

import type { BlameSnapshot } from './attribution';
import { $lexicalLines } from './lexical';
import { type BlameRun, mainAuthor, matchLines } from './lines';

export interface TextSpan {
  start: number;
  end: number;
  personId: string;
}

export interface PaintedLine {
  element: HTMLElement;
  /** Who wrote most of it; null for an empty or unclaimed line. */
  author: string | null;
}

export interface PaintPlan {
  /** Ranges per person, in document order. */
  ranges: Map<string, StaticRange[]>;
  /** Attributed spans per text node, for the hover card. */
  spans: Map<Text, TextSpan[]>;
  /** Matched lines, in document order. */
  lines: PaintedLine[];
}

export interface Segment {
  /** Null for a line break (`<br>`), which counts one character. */
  node: Text | null;
  start: number;
  length: number;
}

/**
 * The element's text as runs see it: text nodes, with each `<br>` as a line
 * break. Lexical adds a `<br>` of its own to an empty line and after a
 * trailing line break; `text` may be followed by such breaks only.
 */
export function segmentsFor(element: HTMLElement, text: string): Segment[] | null {
  const segments: Segment[] = [];
  let domText = '';
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node as Text).data;
      if (value.length > 0) {
        segments.push({ node: node as Text, start: domText.length, length: value.length });
        domText += value;
      }
    } else if (node.nodeName === 'BR') {
      segments.push({ node: null, start: domText.length, length: 1 });
      domText += '\n';
    }
    if (domText.length > text.length + 2) {
      return null;
    }
  }
  if (domText !== text && !(domText.startsWith(text) && /^\n+$/.test(domText.slice(text.length)))) {
    return null;
  }
  return segments;
}

/**
 * Maps a line's runs onto its segments in one sweep (runs and segments are
 * both in order), filling the plan's ranges and hover spans.
 */
export function mapRuns(plan: PaintPlan, segments: Segment[], runs: readonly BlameRun[]): void {
  let cursor = 0;
  let offset = 0;
  for (const run of runs) {
    const start = offset;
    const end = start + run.length;
    offset = end;
    // Segments wholly before this run are behind every later run too.
    while (
      cursor < segments.length &&
      segments[cursor]!.start + segments[cursor]!.length <= start
    ) {
      cursor++;
    }
    if (run.personId === null) {
      continue;
    }
    let first: { node: Text; offset: number } | null = null;
    let last: { node: Text; offset: number } | null = null;
    for (let i = cursor; i < segments.length && segments[i]!.start < end; i++) {
      const segment = segments[i]!;
      if (segment.node === null) {
        continue;
      }
      const from = Math.max(start, segment.start) - segment.start;
      const to = Math.min(end, segment.start + segment.length) - segment.start;
      if (from >= to) {
        continue;
      }
      first ??= { node: segment.node, offset: from };
      last = { node: segment.node, offset: to };
      let spans = plan.spans.get(segment.node);
      if (spans === undefined) {
        spans = [];
        plan.spans.set(segment.node, spans);
      }
      spans.push({ start: from, end: to, personId: run.personId });
    }
    if (first === null || last === null) {
      continue;
    }
    // Static: highlights don't make the browser track every DOM change; the
    // next recompute (at most a second away) replaces them.
    const range = new StaticRange({
      startContainer: first.node,
      startOffset: first.offset,
      endContainer: last.node,
      endOffset: last.offset,
    });
    let ranges = plan.ranges.get(run.personId);
    if (ranges === undefined) {
      ranges = [];
      plan.ranges.set(run.personId, ranges);
    }
    ranges.push(range);
  }
}

export function planLine(
  plan: PaintPlan,
  element: HTMLElement,
  text: string,
  runs: readonly BlameRun[],
): boolean {
  const segments = segmentsFor(element, text);
  if (segments === null) {
    return false;
  }
  mapRuns(plan, segments, runs);
  return true;
}

/** Matches the snapshot's lines to the editor's line elements and plans the paint. */
export function planPaint(editor: LexicalEditor, snapshot: BlameSnapshot): PaintPlan {
  const plan: PaintPlan = { ranges: new Map(), spans: new Map(), lines: [] };
  try {
    const lexical = editor.getEditorState().read(() => $lexicalLines(), { editor });
    const matches = matchLines(
      lexical.map((line) => line.text),
      snapshot.lines,
    );
    lexical.forEach((line, i) => {
      const index = matches[i]!;
      const blame = index >= 0 ? snapshot.lines[index] : undefined;
      const element = editor.getElementByKey(line.key);
      if (blame === undefined || element === null) {
        return;
      }
      if (planLine(plan, element, blame.text, blame.runs)) {
        plan.lines.push({ element, author: mainAuthor(blame) });
      }
    });
  } catch (error) {
    console.warn('jot: blame skipped painting', error);
  }
  return plan;
}

/** The attributed span under a point in a text node, if any. */
export function spanAt(spans: Map<Text, TextSpan[]>, node: Node, offset: number): TextSpan | null {
  const list = node.nodeType === Node.TEXT_NODE ? spans.get(node as Text) : undefined;
  if (list === undefined) {
    return null;
  }
  return list.find((span) => offset >= span.start && offset < span.end) ?? null;
}

export interface MarginGroup {
  author: string;
  top: number;
  height: number;
}

/**
 * Runs of consecutive lines whose main author is the same person, as boxes
 * relative to `origin`. Empty lines neither break nor start a run.
 */
export function marginGroups(lines: readonly PaintedLine[], origin: DOMRect): MarginGroup[] {
  const groups: MarginGroup[] = [];
  let current: { author: string; top: number; bottom: number } | null = null;
  for (const line of lines) {
    if (line.author === null || !line.element.isConnected) {
      continue;
    }
    const rect = line.element.getBoundingClientRect();
    if (rect.height === 0) {
      continue;
    }
    const top = rect.top - origin.top;
    const bottom = rect.bottom - origin.top;
    if (current !== null && current.author === line.author) {
      current.bottom = Math.max(current.bottom, bottom);
    } else {
      if (current !== null) {
        groups.push({
          author: current.author,
          top: current.top,
          height: current.bottom - current.top,
        });
      }
      current = { author: line.author, top, bottom };
    }
  }
  if (current !== null) {
    groups.push({ author: current.author, top: current.top, height: current.bottom - current.top });
  }
  return groups;
}
