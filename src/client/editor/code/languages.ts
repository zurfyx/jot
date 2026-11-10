import { DEFAULT_CODE_LANGUAGE } from '@lexical/code-core';

/**
 * The languages a code block can be highlighted in, by the ids
 * `@lexical/code-prism` loads, in the order the picker lists them. A copy of
 * its list, so the picker needs nothing from the highlighter's lazy chunk;
 * `languages.test.ts` keeps the two equal.
 */
export const CODE_LANGUAGES: readonly (readonly [id: string, label: string])[] = [
  ['plain', 'Plain text'],
  ['c', 'C'],
  ['clike', 'C-like'],
  ['cpp', 'C++'],
  ['css', 'CSS'],
  ['go', 'Go'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['js', 'JavaScript'],
  ['markdown', 'Markdown'],
  ['objc', 'Objective-C'],
  ['powershell', 'PowerShell'],
  ['py', 'Python'],
  ['rust', 'Rust'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['typescript', 'TypeScript'],
  ['xml', 'XML'],
];

/** Other names for those languages (```ts, ```python), as `@lexical/code-prism` maps them. */
const ALIASES: Readonly<Record<string, string>> = {
  golang: 'go',
  javascript: 'js',
  md: 'markdown',
  plaintext: 'plain',
  python: 'py',
  text: 'plain',
  ts: 'typescript',
};

/**
 * The picker's id for a code block's stored language. A block with none is
 * highlighted as the highlighter's default (JavaScript), which it then stores.
 */
export function codeLanguageId(language: string | null | undefined): string {
  const name =
    language === null || language === undefined || language === ''
      ? DEFAULT_CODE_LANGUAGE
      : language;
  return Object.hasOwn(ALIASES, name) ? (ALIASES[name] as string) : name;
}

/** "TypeScript" for `ts`; a language jot doesn't list keeps its own name. */
export function codeLanguageLabel(language: string | null | undefined): string {
  const id = codeLanguageId(language);
  return CODE_LANGUAGES.find(([candidate]) => candidate === id)?.[1] ?? id;
}
