import { describe, expect, it } from 'vitest';

/**
 * The chunk boundaries, from the source: what each entry imports statically
 * (dynamic `import()` is where a chunk splits). The landing page must not
 * reach the docs, and the docs must not reach Lexical or Yjs; the inspector
 * loads them on its own page, behind `lazy()`.
 */
const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const STATIC_IMPORT = /^\s*import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

/** `specifier` relative to `from`, as a key of SOURCES, or null. */
function resolveLocal(from: string, specifier: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.') {
      parts.push(part);
    }
  }
  const base = parts.join('/');
  return (
    [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((key) => key in SOURCES) ?? null
  );
}

/** Every file and package reached from `entry` by static, non-type imports. */
function staticGraph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) {
      return;
    }
    files.add(file);
    for (const [, typeOnly, specifier] of (SOURCES[file] ?? '').matchAll(STATIC_IMPORT)) {
      if (typeOnly !== undefined || specifier === undefined || specifier.includes('?')) {
        continue; // types vanish; `?raw` is text
      }
      if (specifier.startsWith('.')) {
        const target = resolveLocal(file, specifier);
        if (target !== null) {
          visit(target);
        }
      } else {
        packages.add(specifier);
      }
    }
  };
  visit(entry);
  return { files, packages };
}

const isEngine = (name: string) => /^(lexical|@lexical\/|@y\/|lib0)/.test(name);

describe('chunk boundaries', () => {
  it('keeps the docs out of the landing bundle', () => {
    const { files } = staticGraph('/src/client/main.tsx');
    expect(files.has('/src/client/App.tsx')).toBe(true);
    expect([...files].filter((file) => file.includes('/client/docs/'))).toEqual([]);
    expect([...files].filter((file) => file.includes('/client/editor/'))).toEqual([]);
  });

  it('keeps Lexical and Yjs out of the docs, except the lazy inspector', () => {
    const { files, packages } = staticGraph('/src/client/docs/DocsPage.tsx');
    expect([...packages].filter(isEngine)).toEqual([]);
    expect(files.has('/src/client/docs/Inspector.tsx')).toBe(false);
    // The inspector does load them (it is a real jot editor).
    const inspector = staticGraph('/src/client/docs/Inspector.tsx');
    expect([...inspector.packages].some(isEngine)).toBe(true);
  });
});
