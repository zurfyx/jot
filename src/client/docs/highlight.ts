/**
 * A small TypeScript highlighter for the docs' code blocks: comments,
 * strings, keywords and numbers. Enough to read by, with no dependency.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'readonly',
  'return',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'void',
  'while',
]);

const TS_PATTERN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`)|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g;

const SHELL_PATTERN = /(#[^\n]*)/g;

/** Splits `source` into tokens whose texts concatenate back to `source`. */
export function highlight(source: string, language: 'ts' | 'shell' = 'ts'): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (text === '') {
      return;
    }
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.kind === kind) {
      last.text += text;
    } else {
      tokens.push({ kind, text });
    }
  };
  const pattern = language === 'ts' ? TS_PATTERN : SHELL_PATTERN;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    push('plain', source.slice(last, match.index));
    const [text, comment, string, number, word] = match;
    if (comment !== undefined) {
      push('comment', text);
    } else if (string !== undefined) {
      push('string', text);
    } else if (number !== undefined) {
      push('number', text);
    } else if (word !== undefined && KEYWORDS.has(word)) {
      push('keyword', text);
    } else {
      push('plain', text);
    }
    last = match.index + text.length;
  }
  push('plain', source.slice(last));
  return tokens;
}
