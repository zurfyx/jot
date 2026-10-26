/**
 * Blame's model: the note as lines of runs, each run written by one person.
 *
 * Built from the `lexical-y` root rendered with Yjs 14 attributions
 * (`toDelta({ deep: true, renderer })`). The layout is @lexical/y's wire
 * format: in each container, inline text is followed by a `¶` marker (a line)
 * or a `¦` terminator (inline content of the container itself); `b:<type>`
 * children are blocks stored as their own nodes, and `i:<type>` children are
 * nodes inside a line. Nothing here throws: a shape it does not know marks
 * the line as unreadable, and painting skips it.
 */

export interface BlameRun {
  /** Characters, in the line's text (a line break counts as one). */
  length: number;
  /** The person who wrote it, or null when nobody claims it. */
  personId: string | null;
}

export interface BlameLine {
  text: string;
  runs: BlameRun[];
  /** False when the line held content blame cannot measure. */
  readable: boolean;
}

const LINE_MARKER = '¶';
const RUN_TERMINATOR = '¦';
const MOVE = '↷';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

function personOf(op: Json): string | null {
  const attribution = op.attribution;
  if (!isObject(attribution)) {
    return null;
  }
  const insert = attribution.insert;
  if (!Array.isArray(insert)) {
    return null;
  }
  const first: unknown = insert[0];
  return typeof first === 'string' ? first : null;
}

class LineBuilder {
  readonly lines: BlameLine[] = [];
  /** A move record (`↷`) was seen: storage order is not the shown order. */
  moves = false;
  private text = '';
  private runs: BlameRun[] = [];
  private readable = true;

  get pending(): boolean {
    return this.text !== '' || !this.readable;
  }

  addText(text: string, personId: string | null): void {
    if (text === '') {
      return;
    }
    this.text += text;
    const last = this.runs[this.runs.length - 1];
    if (last !== undefined && last.personId === personId) {
      last.length += text.length;
    } else {
      this.runs.push({ length: text.length, personId });
    }
  }

  spoil(): void {
    this.readable = false;
  }

  end(): void {
    this.lines.push({ text: this.text, runs: this.runs, readable: this.readable });
    this.text = '';
    this.runs = [];
    this.readable = true;
  }
}

function attr(node: Json, key: string): unknown {
  const attrs = node.attrs;
  if (!isObject(attrs)) {
    return undefined;
  }
  const entry = attrs[key];
  return isObject(entry) ? entry.value : undefined;
}

/** Walks a container's children; returns nothing, fills `out`. */
function walkContainer(node: Json, out: LineBuilder, depth: number): void {
  const children = node.children;
  if (!Array.isArray(children) || depth > 64) {
    return;
  }
  for (const op of children as unknown[]) {
    if (!isObject(op) || op.type !== 'insert') {
      // Retains and deletes do not appear in a full render; skip them.
      continue;
    }
    const insert = op.insert;
    if (typeof insert === 'string') {
      out.addText(insert, personOf(op));
      continue;
    }
    if (!Array.isArray(insert)) {
      out.spoil();
      continue;
    }
    for (const item of insert as unknown[]) {
      if (!isObject(item) || item.type !== 'delta' || typeof item.name !== 'string') {
        // An embed blame cannot measure.
        out.spoil();
        continue;
      }
      const name = item.name;
      if (name === LINE_MARKER || name === RUN_TERMINATOR) {
        out.end();
      } else if (name.startsWith('b:') || (name.startsWith('i:') && attr(item, 'u') === 1)) {
        // A block (or a lifted block): a unit of the container.
        if (out.pending) {
          out.end();
        }
        walkContainer(item, out, depth + 1);
      } else if (name.startsWith('i:')) {
        // A node inside the line: its content is part of this line.
        if (attr(item, 'c') === 'b') {
          out.spoil();
        } else {
          walkInline(item, out, depth + 1);
        }
      } else if (name === MOVE) {
        // Moves and joins carry no text; moves.ts finds the lines they touch.
        out.moves = true;
      }
    }
  }
  if (out.pending) {
    // Inline content left without a terminator.
    out.end();
  }
}

/** The text of an inline node, added to the current line. */
function walkInline(node: Json, out: LineBuilder, depth: number): void {
  const children = node.children;
  if (!Array.isArray(children) || depth > 64) {
    return;
  }
  for (const op of children as unknown[]) {
    if (!isObject(op) || op.type !== 'insert') {
      continue;
    }
    if (typeof op.insert === 'string') {
      out.addText(op.insert, personOf(op));
    } else if (Array.isArray(op.insert)) {
      for (const item of op.insert as unknown[]) {
        if (isObject(item) && item.type === 'delta' && typeof item.name === 'string') {
          if (item.name.startsWith('i:')) {
            walkInline(item, out, depth + 1);
          } else if (item.name !== RUN_TERMINATOR) {
            out.spoil();
          }
        } else {
          out.spoil();
        }
      }
    }
  }
}

/**
 * The lines of a `lexical-y` root's deep delta (its `toJSON()`), in storage
 * order, and whether it holds move records. Never throws; a malformed delta
 * gives fewer or unreadable lines.
 */
export function readDelta(delta: unknown): { lines: BlameLine[]; moves: boolean } {
  const out = new LineBuilder();
  try {
    if (isObject(delta)) {
      walkContainer(delta, out, 0);
    }
  } catch {
    // What was read so far stands.
  }
  return { lines: out.lines, moves: out.moves };
}

export function linesFromDelta(delta: unknown): BlameLine[] {
  return readDelta(delta).lines;
}

/** Characters per person over every line (unattributed text is left out). */
export function sharesOf(lines: readonly BlameLine[]): Map<string, number> {
  const shares = new Map<string, number>();
  for (const line of lines) {
    for (const run of line.runs) {
      if (run.personId !== null) {
        shares.set(run.personId, (shares.get(run.personId) ?? 0) + run.length);
      }
    }
  }
  return shares;
}

/** The person who wrote most of a line, or null when nobody wrote any of it. */
export function mainAuthor(line: BlameLine): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const run of line.runs) {
    if (run.personId === null) {
      continue;
    }
    const count = (counts.get(run.personId) ?? 0) + run.length;
    counts.set(run.personId, count);
    if (count > bestCount) {
      best = run.personId;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Pairs Lexical's lines with blame's, never guessing. Only readable blame
 * lines take part (moved and joined ones are not). A line whose text is
 * unique on both sides pairs wherever it is; a text that appears more than
 * once pairs only in order, when both sides hold it the same number of times
 * and the lines line up exactly. Returns, per Lexical line, the index of its
 * blame line or -1 (left unpainted).
 */
export function matchLines(lexical: readonly string[], blame: readonly BlameLine[]): number[] {
  const result = new Array<number>(lexical.length).fill(-1);
  const lexicalCount = new Map<string, number>();
  for (const text of lexical) {
    lexicalCount.set(text, (lexicalCount.get(text) ?? 0) + 1);
  }
  const blameCount = new Map<string, number>();
  const uniqueAt = new Map<string, number>();
  blame.forEach((line, k) => {
    if (line.readable) {
      blameCount.set(line.text, (blameCount.get(line.text) ?? 0) + 1);
      uniqueAt.set(line.text, k);
    }
  });
  const used = new Uint8Array(blame.length);
  let j = 0;
  for (let i = 0; i < lexical.length; i++) {
    const text = lexical[i]!;
    const inLexical = lexicalCount.get(text) ?? 0;
    const inBlame = blameCount.get(text) ?? 0;
    if (inLexical === 1 && inBlame === 1) {
      const k = uniqueAt.get(text)!;
      result[i] = k;
      used[k] = 1;
      j = Math.max(j, k + 1);
      continue;
    }
    if (inLexical !== inBlame || inBlame === 0) {
      continue;
    }
    // A repeated text: only the next readable line, in order.
    while (j < blame.length && (used[j] || !blame[j]!.readable)) {
      j++;
    }
    if (j < blame.length && blame[j]!.text === text) {
      result[i] = j;
      used[j] = 1;
      j++;
    }
  }
  return result;
}
