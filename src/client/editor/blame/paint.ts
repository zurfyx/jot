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
  ranges: Map<string, Range[]>;
  /** Attributed spans per text node, for the hover card. */
  spans: Map<Text, TextSpan[]>;
  /** Matched lines, in document order. */
  lines: PaintedLine[];
}

interface Segment {
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

/** A Range over [start, end) of the line, or null where it covers only line breaks. */
function rangeFor(segments: Segment[], start: number, end: number): Range | null {
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (const segment of segments) {
    if (segment.node === null) {
      continue;
    }
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.start + segment.length);
    if (from >= to) {
      continue;
    }
    first ??= { node: segment.node, offset: from - segment.start };
    last = { node: segment.node, offset: to - segment.start };
  }
  if (first === null || last === null) {
    return null;
  }
  const range = new Range();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return range;
}

/** Records the spans of one run on each text node it crosses. */
function addSpans(
  spans: Map<Text, TextSpan[]>,
  segments: Segment[],
  start: number,
  end: number,
  personId: string,
): void {
  for (const segment of segments) {
    if (segment.node === null) {
      continue;
    }
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.start + segment.length);
    if (from < to) {
      let list = spans.get(segment.node);
      if (list === undefined) {
        list = [];
        spans.set(segment.node, list);
      }
      list.push({ start: from - segment.start, end: to - segment.start, personId });
    }
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
  let offset = 0;
  for (const run of runs) {
    const start = offset;
    offset += run.length;
    if (run.personId === null) {
      continue;
    }
    const range = rangeFor(segments, start, offset);
    if (range === null) {
      continue;
    }
    let list = plan.ranges.get(run.personId);
    if (list === undefined) {
      list = [];
      plan.ranges.set(run.personId, list);
    }
    list.push(range);
    addSpans(plan.spans, segments, start, offset, run.personId);
  }
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
