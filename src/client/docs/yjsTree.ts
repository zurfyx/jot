/**
 * Turns the `lexical-y` root of a note into rows for the docs' inspector:
 * the root's attributes, one row per line (its text runs and its ¶ marker),
 * and one row per node stored as its own Y.Node (a table, a row, a cell),
 * with its children indented below it. The layout is @lexical/y's
 * "Wire format" (node_modules/@lexical/y/README.md).
 */

import type * as Y from '@y/y';

export interface Attr {
  key: string;
  /** The value as the inspector prints it: strings quoted, JSON compact. */
  value: string;
}

export interface Segment {
  text: string;
  /** Text formats (`f:bold`, `w:link`, …), or for an inline node its name. */
  attrs: Attr[];
  /** Set for an `i:<type>` node inside the line. */
  node?: string;
}

export type Row =
  | { kind: 'root'; depth: 0; name: string; attrs: Attr[] }
  | {
      kind: 'line';
      depth: number;
      segments: Segment[];
      /** The ¶ marker's attributes: the line's type, schema fields, group. */
      marker: Attr[];
      /** The line's index among all lines, in document order. */
      line: number;
      text: string;
    }
  | { kind: 'run'; depth: number; segments: Segment[]; text: string }
  | { kind: 'node'; depth: number; name: string; attrs: Attr[] };

export const LINE_MARKER = '¶';
export const RUN_TERMINATOR = '¦';

interface Walk {
  rows: Row[];
  lines: number;
}

/** Rows for a deep delta of the root (`root.toDelta({ deep: true })`, as JSON). */
export function rowsFromDelta(delta: unknown, rootName = 'lexical-y'): Row[] {
  const walk: Walk = { rows: [], lines: 0 };
  const record = asRecord(delta);
  walk.rows.push({ kind: 'root', depth: 0, name: rootName, attrs: readAttrs(record?.attrs) });
  walkChildren(record?.children, 1, walk);
  return walk.rows;
}

/** Rows for a document's root, read now. */
export function readRows(doc: Y.Doc, rootName = 'lexical-y'): Row[] {
  const delta = doc.get(rootName).toDelta({ deep: true });
  return rowsFromDelta(JSON.parse(JSON.stringify(delta)), rootName);
}

function walkChildren(children: unknown, depth: number, walk: Walk): void {
  if (!Array.isArray(children)) {
    return;
  }
  let pending: Segment[] = [];
  const text = () => pending.map((segment) => segment.text).join('');
  const flushOrphans = () => {
    // Inline content with no marker yet: a line someone is still writing
    // into, or content after the last marker. Show it as an open run.
    if (pending.length > 0) {
      walk.rows.push({ kind: 'run', depth, segments: pending, text: text() });
      pending = [];
    }
  };

  for (const op of children) {
    const entry = asRecord(op);
    if (entry === null || (entry.type !== undefined && entry.type !== 'insert')) {
      continue;
    }
    const insert = entry.insert;
    if (typeof insert === 'string') {
      pending.push({ text: insert, attrs: readFormat(entry.format) });
      continue;
    }
    if (!Array.isArray(insert)) {
      continue;
    }
    for (const item of insert) {
      const node = asRecord(item);
      const name = typeof node?.name === 'string' ? node.name : '';
      const attrs = readAttrs(node?.attrs);
      if (name === LINE_MARKER) {
        walk.rows.push({
          kind: 'line',
          depth,
          segments: pending,
          marker: attrs,
          line: walk.lines++,
          text: text(),
        });
        pending = [];
      } else if (name === RUN_TERMINATOR) {
        walk.rows.push({ kind: 'run', depth, segments: pending, text: text() });
        pending = [];
      } else if (name.startsWith('i:') && !attrs.some((attr) => attr.key === 'u')) {
        pending.push({ text: '', attrs, node: name });
      } else {
        flushOrphans();
        walk.rows.push({ kind: 'node', depth, name, attrs });
        walkChildren(node?.children, depth + 1, walk);
      }
    }
  }
  flushOrphans();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Node attributes: in a deep delta each one is `{type: 'insert', value}`. */
function readAttrs(value: unknown): Attr[] {
  const record = asRecord(value);
  if (record === null) {
    return [];
  }
  return Object.entries(record).map(([key, raw]) => {
    const op = asRecord(raw);
    const plain = op !== null && op.type === 'insert' && 'value' in op ? op.value : raw;
    return { key, value: printValue(plain) };
  });
}

function readFormat(value: unknown): Attr[] {
  const record = asRecord(value);
  if (record === null) {
    return [];
  }
  return Object.entries(record).map(([key, raw]) => ({ key, value: printValue(raw) }));
}

/** Primitives as they are; @lexical/y stores other JSON as `\u0000` + JSON. */
export function printValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.startsWith('\u0000') ? value.slice(1) : JSON.stringify(value);
  }
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value);
}

/** Text as the inspector shows it: line breaks and tabs made visible. */
export function visibleText(text: string): string {
  return text.replace(/\n/g, '↵').replace(/\t/g, '⇥');
}
