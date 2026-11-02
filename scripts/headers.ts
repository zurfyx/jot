/**
 * The `_headers` rules the build writes (D32, D33), file by file: a pattern
 * would also reach an unknown path's 404 page, which the assets serve under
 * any path with the same rules.
 */

/** Cloudflare's limit on rules in one `_headers` file. */
export const MAX_RULES = 100;

/** Vite's output names: `<name>-<8-character hash>.<ext>`. */
const HASHED = /-[\w-]{8}\.[a-z\d]+$/i;

export function isHashed(file: string): boolean {
  return HASHED.test(file);
}

/** A year, and never revalidated: the file's name changes with its content. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** What assistants read (D32), with its type in UTF-8; null for any other file. */
export function textType(file: string): string | null {
  if (file.endsWith('.md')) return 'text/markdown';
  if (file.endsWith('.txt')) return 'text/plain';
  if (file.endsWith('.xml')) return 'application/xml';
  return null;
}

/**
 * The rules for the generated files (`types`, paths from the client root)
 * and the built assets (`assets`, names under `assets/`): a type for each
 * text file, and immutable caching for each content-hashed asset. A file
 * whose name has no hash keeps the default, revalidated on every use.
 */
export function headerRules(generated: readonly string[], assets: readonly string[]): string[] {
  const types = generated.flatMap((file) => {
    const type = textType(file);
    return type === null ? [] : [`/${file}\n  Content-Type: ${type}; charset=utf-8`];
  });
  const cached = assets
    .filter(isHashed)
    .map((file) => `/assets/${file}\n  Cache-Control: ${IMMUTABLE}`);
  return [
    '# What assistants read (D32), written by scripts/prerender.ts.',
    ...types,
    '# Content-hashed assets, cached for a year (D33), written by scripts/prerender.ts.',
    ...cached,
  ];
}

/** How many rules a `_headers` file holds: each starts with a path at the line's start. */
export function countRules(text: string): number {
  return text.split('\n').filter((line) => line.startsWith('/')).length;
}
