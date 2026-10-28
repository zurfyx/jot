/**
 * A rewrite of a text node as exact splices. jot AI writes a reply into the
 * old text nodes, and `@lexical/y` records `spliceText` with its offsets, so
 * each change lands where it was made: a peer's concurrent typing inside a
 * word the rewrite kept stays in that word. `setTextContent` is recorded as
 * before and after only, and the binding diffs those as one stretch from the
 * first change to the last, so typing between two changes lost its place.
 */
import type { TextNode } from 'lexical';

/** Characters `start` to `end` of the old text become `text`. */
export interface Hunk {
  start: number;
  end: number;
  text: string;
}

/**
 * Words (letters, marks, digits, underscores), runs of whitespace, and any
 * other character alone (punctuation). Whole code points, so a hunk never
 * splits a surrogate pair.
 */
const TOKEN = /[\p{L}\p{M}\p{N}_]+|\s+|[^]/gu;

/**
 * Above this many cells (changed old tokens times changed new tokens) the
 * table is not built and the changed middle is one hunk: a passage rewritten
 * through and through, where the splices could not keep much anyway.
 */
const MAX_CELLS = 4_000_000;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/**
 * The hunks that turn `before` into `after`, in order and apart: the tokens
 * outside them form a longest common subsequence of the two texts' tokens.
 * Applied right to left, each hunk's offsets are still the old text's.
 */
export function diffWords(before: string, after: string): Hunk[] {
  if (before === after) {
    return [];
  }
  const a = tokenize(before);
  const b = tokenize(after);
  // The common start and end, without the table.
  let head = 0;
  let headChars = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    headChars += a[head]!.length;
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const hunks: Hunk[] = [];
  let oldAt = headChars;
  let pending: Hunk | null = null;
  const keep = (token: string) => {
    if (pending !== null) {
      hunks.push(pending);
      pending = null;
    }
    oldAt += token.length;
  };
  const remove = (token: string) => {
    pending ??= { start: oldAt, end: oldAt, text: '' };
    pending.end += token.length;
    oldAt += token.length;
  };
  const insert = (token: string) => {
    pending ??= { start: oldAt, end: oldAt, text: '' };
    pending.text += token;
  };
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    for (let i = 0; i < n; i++) {
      remove(a[head + i]!);
    }
    for (let j = 0; j < m; j++) {
      insert(b[head + j]!);
    }
  } else {
    // lcs[i * (m + 1) + j]: the longest common subsequence of the changed
    // middles' tokens from i and from j on.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          a[head + i] === b[head + j]
            ? lcs[(i + 1) * width + j + 1]! + 1
            : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) {
        keep(a[head + i]!);
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)) {
        insert(b[head + j]!);
        j++;
      } else {
        remove(a[head + i]!);
        i++;
      }
    }
  }
  if (pending !== null) {
    hunks.push(pending);
  }
  return hunks;
}

/**
 * Sets `node`'s text to `text` with one `spliceText` per hunk of the word
 * diff, right to left (so each hunk's offsets hold), leaving the words both
 * texts share untouched. Does nothing when the text is already `text`.
 */
export function $applyTextDiff(node: TextNode, text: string): void {
  const hunks = diffWords(node.getTextContent(), text);
  for (let k = hunks.length - 1; k >= 0; k--) {
    const { start, end, text: inserted } = hunks[k]!;
    node.spliceText(start, end - start, inserted, false);
  }
}
