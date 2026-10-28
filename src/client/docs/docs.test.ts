import { describe, expect, it } from 'vitest';

import { DOCS } from '../landing/Landing';
import { matchRoute } from '../router';
import { excerpt } from './excerpt';
import { highlight } from './highlight';
import { DOCS_GROUPS, DOCS_PAGES, docsPath, findDocsPage, neighbours } from './pages';
import { LEXICAL_SHA, LEXICAL_Y_README, SNIPPETS, sourceUrl } from './sources';

describe('the docs pages', () => {
  it('route /docs and /docs/<slug>', () => {
    expect(matchRoute('/docs')).toEqual({ name: 'docs', slug: '' });
    expect(matchRoute('/docs/')).toEqual({ name: 'docs', slug: '' });
    expect(matchRoute('/docs/quick-start')).toEqual({ name: 'docs', slug: 'quick-start' });
    expect(matchRoute('/docs/a/b')).toEqual({ name: 'missing' });
    for (const page of DOCS_PAGES) {
      expect(matchRoute(docsPath(page.slug))).toEqual({ name: 'docs', slug: page.slug });
    }
  });

  it('cover every link the landing page makes', () => {
    for (const href of Object.values(DOCS)) {
      const route = matchRoute(href);
      expect(route.name).toBe('docs');
      expect(route.name === 'docs' && findDocsPage(route.slug)).toBeTruthy();
    }
  });

  it('are grouped Start, Concepts, Features, Server, in reading order', () => {
    const groups = DOCS_PAGES.map((page) => page.group);
    expect([...new Set(groups)]).toEqual([...DOCS_GROUPS]);
    expect(new Set(DOCS_PAGES.map((page) => page.slug)).size).toBe(DOCS_PAGES.length);
    expect(neighbours('').previous).toBeUndefined();
    expect(neighbours('quick-start')).toEqual({
      previous: DOCS_PAGES[0],
      next: DOCS_PAGES[2],
    });
    expect(neighbours(DOCS_PAGES.at(-1)!.slug).next).toBeUndefined();
  });
});

describe('the code blocks', () => {
  it('highlight without losing a character', () => {
    const source = "import { a } from 'b';\n// note\nconst n = 42; /* x */ `t ${a}`";
    const tokens = highlight(source);
    expect(tokens.map((token) => token.text).join('')).toBe(source);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: 'keyword', text: 'import' },
        { kind: 'string', text: "'b'" },
        { kind: 'comment', text: '// note' },
        { kind: 'number', text: '42' },
        { kind: 'string', text: '`t ${a}`' },
      ]),
    );
    expect(highlight('pnpm add x # y', 'shell')).toEqual([
      { kind: 'plain', text: 'pnpm add x ' },
      { kind: 'comment', text: '# y' },
    ]);
  });

  it('cut whole declarations out of real files', () => {
    const source = [
      'const a = 1;',
      '',
      '/** Adds. */',
      'export function add(x: number) {',
      "  if (x) { return '}'; }",
      '  return x;',
      '}',
      'const b = 2;',
    ].join('\n');
    expect(excerpt(source, 'export function add(')).toEqual({
      code: source.split('\n').slice(2, 7).join('\n'),
      startLine: 3,
      endLine: 7,
    });
    expect(() => excerpt(source, 'function gone(')).toThrow();
  });

  it("show jot's own code, linked to its exact lines", () => {
    expect(SNIPPETS.roomUpdate.code).toMatch(/^\/\*\*[\s\S]*private receiveUpdate\([\s\S]*\n}$/);
    expect(SNIPPETS.roomFetch.code).toContain('acceptWebSocket');
    expect(SNIPPETS.fitsUnderCap.code).toContain('UPDATE_OVERHEAD_BYTES');
    expect(SNIPPETS.contentMap.code).toContain('createContentAttribute');
    expect(SNIPPETS.computeBlame.code).toContain('createAttributionsRenderer');
    expect(SNIPPETS.roomUpdate.href).toMatch(/room\.ts#L\d+-L\d+$/);
    expect(SNIPPETS.quickStart.href).toBe(sourceUrl('src/docs/snippets/quick-start.ts'));
    for (const source of Object.values(SNIPPETS)) {
      expect(source.code.trim()).not.toBe('');
      expect(source.code).not.toMatch(/—/);
    }
  });

  it('link the binding at the Lexical commit jot pins', () => {
    expect(LEXICAL_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(LEXICAL_Y_README).toBe(
      `https://github.com/meta/lexical/blob/${LEXICAL_SHA}/packages/lexical-y/README.md`,
    );
    expect(SNIPPETS.quickStart.code).toContain('provider.messageHandlers[MESSAGE_NOTE_STATUS]');
  });

  it('install the same packages jot does', () => {
    expect(SNIPPETS.install.code).toContain('@y/y@14.0.0-rc.29');
    expect(SNIPPETS.install.code).toMatch(/pkg\.pr\.new\/meta\/lexical\/@lexical\/y@[0-9a-f]{40}/);
  });
});
