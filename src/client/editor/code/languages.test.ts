import {
  CODE_LANGUAGE_FRIENDLY_NAME_MAP,
  CODE_LANGUAGE_MAP,
  isCodeLanguageLoaded,
} from '@lexical/code-prism';
import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES, codeLanguageId, codeLanguageLabel } from './languages';

describe('the code languages', () => {
  it("are @lexical/code-prism's, with its names in sentence case", () => {
    const theirs = Object.fromEntries(
      Object.entries(CODE_LANGUAGE_FRIENDLY_NAME_MAP).map(([id, name]) => [
        id,
        id === 'plain' ? 'Plain text' : name,
      ]),
    );
    expect(Object.fromEntries(CODE_LANGUAGES)).toEqual(theirs);
  });

  it('each have a grammar in the highlighter (plain text an empty one)', () => {
    for (const [id] of CODE_LANGUAGES) {
      expect(isCodeLanguageLoaded(id), id).toBe(true);
    }
  });

  it("read the highlighter's other names as the language they name", () => {
    for (const [alias, id] of Object.entries(CODE_LANGUAGE_MAP)) {
      expect(codeLanguageId(alias), alias).toBe(id);
    }
    expect(codeLanguageId('ts')).toBe('typescript');
    expect(codeLanguageId('python')).toBe('py');
    expect(codeLanguageLabel('javascript')).toBe('JavaScript');
  });

  it('take a block without a language as JavaScript, the default the highlighter stores', () => {
    for (const none of [undefined, null, '']) {
      expect(codeLanguageId(none)).toBe('js');
      expect(codeLanguageLabel(none)).toBe('JavaScript');
    }
  });

  it("keep a language jot doesn't list as written, even one named like an object's property", () => {
    expect(codeLanguageId('ruby')).toBe('ruby');
    expect(codeLanguageLabel('ruby')).toBe('ruby');
    expect(codeLanguageId('constructor')).toBe('constructor');
    expect(codeLanguageLabel('toString')).toBe('toString');
  });
});
