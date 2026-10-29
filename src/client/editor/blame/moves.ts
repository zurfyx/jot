/**
 * Move records (`↷`) and joins, which notes written before `@lexical/y`
 * froze its layout can hold (D25; their root records `lexical-y` = 2).
 *
 * In such a note, a moved block's items stay where they were, and a move
 * record sits where the block now shows; a join shows a range inline, inside
 * another line. `toDelta` renders storage order, so lines a record covers
 * are not where Lexical shows them, and a joined line is made of pieces
 * from elsewhere. Blame does not guess: this walk of the stored items finds
 * every line a record's range covers (and, for a join, the line it shows in)
 * so they are left unpainted. It mirrors `lines.ts`'s walk of the delta
 * line for line; if the two disagree, every line counts as moved.
 */
import * as Y from '@y/y';

import type { BlameLine } from './lines';

const LINE_MARKER = '¶';
const RUN_TERMINATOR = '¦';
const MOVE = '↷';

interface Walk {
  doc: Y.Doc;
  texts: string[];
  text: string;
  spoiled: boolean;
  /** The lines each stored item belongs to (a block: all of its lines). */
  spans: Map<Y.Item, [number, number]>;
  moved: Set<number>;
}

function end(walk: Walk): void {
  walk.texts.push(walk.text);
  walk.text = '';
  walk.spoiled = false;
}

function pending(walk: Walk): boolean {
  return walk.text !== '' || walk.spoiled;
}

function* items(node: Y.Node): Generator<Y.Item> {
  for (let item = node._start; item !== null; item = item.right) {
    yield item;
  }
}

function markLines(walk: Walk, from: number, to: number): void {
  for (let line = from; line <= to; line++) {
    walk.moved.add(line);
  }
}

function readId(value: unknown): [number, number] | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isSafeInteger(value[0]) &&
    Number.isSafeInteger(value[1])
  ) {
    return [value[0] as number, value[1] as number];
  }
  return null;
}

/** The stored item holding `id`, or null when it has not arrived. */
function itemAt(doc: Y.Doc, [client, clock]: [number, number]): Y.Item | null {
  const structs = doc.store.clients.get(client);
  if (structs === undefined || clock < 0 || clock >= doc.store.getClock(client)) {
    return null;
  }
  const struct = structs[Y.findIndexSS(structs, clock)];
  return struct instanceof Y.Item ? struct : null;
}

function holds(item: Y.Item, [client, clock]: [number, number]): boolean {
  return item.id.client === client && item.id.clock <= clock && clock < item.id.clock + item.length;
}

/**
 * Marks the lines of a record's range: from the item after `s` (or the
 * container's start) to the item holding `e`.
 * Returns false when the range can't be followed.
 */
function markRange(walk: Walk, node: Y.Node, record: Y.Node): boolean {
  const e = readId(record.getAttr('e'));
  const rawS: unknown = record.getAttr('s');
  const s = rawS === null ? null : readId(rawS);
  if (e === null || (rawS !== null && s === null)) {
    return false;
  }
  let item: Y.Item | null = node._start;
  if (s !== null) {
    const before = itemAt(walk.doc, s);
    if (before === null || before.parent !== node) {
      return false;
    }
    // The range is strictly after `s`; an item split by it counts, to be safe.
    item = s[1] === before.id.clock + before.length - 1 ? before.right : before;
  }
  for (; item !== null; item = item.right) {
    const span = walk.spans.get(item);
    if (span !== undefined) {
      markLines(walk, span[0], span[1]);
    }
    if (holds(item, e)) {
      return true;
    }
  }
  return false;
}

function walkContainer(walk: Walk, node: Y.Node, depth: number): void {
  if (depth > 64) {
    return;
  }
  const first = walk.texts.length;
  const records: { item: Y.Item; node: Y.Node }[] = [];
  for (const item of items(node)) {
    if (item.deleted || item.content instanceof Y.ContentFormat) {
      continue;
    }
    const current = walk.texts.length;
    const content = item.content;
    if (content instanceof Y.ContentString) {
      walk.text += content.str;
      walk.spans.set(item, [current, current]);
      continue;
    }
    if (!(content instanceof Y.ContentType)) {
      walk.spoiled = true;
      walk.spans.set(item, [current, current]);
      continue;
    }
    const child = content.type as Y.Node;
    const name = String(child.name);
    if (name === LINE_MARKER || name === RUN_TERMINATOR) {
      walk.spans.set(item, [current, current]);
      end(walk);
    } else if (name.startsWith('b:') || (name.startsWith('i:') && child.getAttr('u') === 1)) {
      if (pending(walk)) {
        end(walk);
      }
      const from = walk.texts.length;
      walkContainer(walk, child, depth + 1);
      walk.spans.set(item, [from, walk.texts.length - 1]);
    } else if (name.startsWith('i:')) {
      if (child.getAttr('c') === 'b') {
        walk.spoiled = true;
      } else {
        walkInline(walk, child, depth + 1);
      }
      walk.spans.set(item, [current, current]);
    } else if (name === MOVE) {
      records.push({ item, node: child });
      walk.spans.set(item, [current, current]);
    }
  }
  if (pending(walk)) {
    end(walk);
  }
  for (const record of records) {
    if (!markRange(walk, node, record.node)) {
      // A range that can't be followed: nothing here can be trusted.
      markLines(walk, first, walk.texts.length - 1);
      return;
    }
    if (record.node.getAttr('j') === 1) {
      const span = walk.spans.get(record.item);
      if (span !== undefined) {
        markLines(walk, span[0], span[1]);
      }
    }
  }
}

function walkInline(walk: Walk, node: Y.Node, depth: number): void {
  if (depth > 64) {
    return;
  }
  for (const item of items(node)) {
    if (item.deleted || item.content instanceof Y.ContentFormat) {
      continue;
    }
    const content = item.content;
    if (content instanceof Y.ContentString) {
      walk.text += content.str;
    } else if (content instanceof Y.ContentType) {
      const name = String((content.type as Y.Node).name);
      if (name.startsWith('i:')) {
        walkInline(walk, content.type as Y.Node, depth + 1);
      } else if (name !== RUN_TERMINATOR) {
        walk.spoiled = true;
      }
    } else {
      walk.spoiled = true;
    }
  }
}

/**
 * Marks the lines move and join records touch as unreadable, in place, so
 * painting skips them. Call only when the delta had a record. Never throws.
 */
export function markMovedLines(doc: Y.Doc, root: Y.Node, lines: BlameLine[]): void {
  const walk: Walk = {
    doc,
    texts: [],
    text: '',
    spoiled: false,
    spans: new Map(),
    moved: new Set(),
  };
  let agree = false;
  try {
    walkContainer(walk, root, 0);
    agree =
      walk.texts.length === lines.length && walk.texts.every((text, i) => text === lines[i]!.text);
  } catch {
    agree = false;
  }
  lines.forEach((line, i) => {
    if (!agree || walk.moved.has(i)) {
      line.readable = false;
    }
  });
}
