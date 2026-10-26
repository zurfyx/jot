/**
 * Cuts one declaration out of a source file, so the docs can show the real
 * code of a function or method rather than a copy that drifts.
 */

export interface Excerpt {
  code: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

/**
 * The block that starts on the first line beginning with `start` (after its
 * indentation), through the line that closes its braces, dedented. Leading
 * doc comments (`/** … *\/` and `//` lines) directly above it are included.
 * Throws when `start` isn't found, so a renamed declaration fails the tests.
 */
export function excerpt(source: string, start: string): Excerpt {
  const lines = source.split('\n');
  const first = lines.findIndex((line) => line.trimStart().startsWith(start));
  if (first === -1) {
    throw new Error(`excerpt: no line starts with ${JSON.stringify(start)}`);
  }
  let depth = 0;
  let opened = false;
  let last = first;
  for (let i = first; i < lines.length; i++) {
    for (const char of stripStringsAndComments(lines[i] ?? '')) {
      if (char === '{') {
        depth++;
        opened = true;
      } else if (char === '}') {
        depth--;
      }
    }
    last = i;
    if (opened && depth <= 0) {
      break;
    }
    if (!opened && /;\s*$/.test(lines[i] ?? '')) {
      break; // a one-statement declaration, such as a constant
    }
  }
  let top = first;
  while (top > 0) {
    const above = (lines[top - 1] ?? '').trim();
    if (above.startsWith('//') || above.startsWith('*') || above.startsWith('/**')) {
      top--;
    } else {
      break;
    }
  }
  const block = lines.slice(top, last + 1);
  const indent = Math.min(
    ...block.filter((line) => line.trim() !== '').map((line) => /^ */.exec(line)![0].length),
  );
  return {
    code: block.map((line) => line.slice(indent)).join('\n'),
    startLine: top + 1,
    endLine: last + 1,
  };
}

/** A line with string and comment contents removed, so their braces don't count. */
function stripStringsAndComments(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '')
    .replace(/\/\/.*$/, '');
}
