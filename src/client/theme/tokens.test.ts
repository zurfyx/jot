/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The colour tokens (D28). Their light values are StyleX variables
 * (tokens.stylex.ts); their dark values are in globals.css, where they apply
 * before the first paint. The landing page repeats both sets in its scope,
 * the light one in themes.ts and the dark one in globals.css (D31),
 * re-pointing only the Night treatment's tokens in dark; the docs' scope has
 * a dark set of its own there.
 */

// Read as files: CSS imported in a test is left out by Vitest.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

/** `--name: value` and `'--name': 'value'` pairs, values as written. */
function tokens(block: string | undefined): Record<string, string> {
  expect(block).toBeDefined();
  return Object.fromEntries(
    [...block!.matchAll(/^\s*['"]?(--[\w-]+)['"]?\s*:\s*['"]?(.+?)['"]?\s*[,;]?\s*$/gm)].map(
      ([, name, value]) => [name!, value!],
    ),
  );
}

const light = tokens(
  /export const colors = stylex\.defineVars\(\{([\s\S]*?)\n\}\);/.exec(
    read('./tokens.stylex.ts'),
  )?.[1],
);
const globals = read('../globals.css');
/** The blocks of globals.css under `selector`, in order. */
const blocks = (selector: string) =>
  [...globals.matchAll(new RegExp(`^${selector} \\{([\\s\\S]*?)\\n\\}`, 'gm'))].map((match) =>
    tokens(match[1]),
  );
const dark = blocks(":root\\[data-theme='dark'\\]")[0]!;
const [landingDark, landingCardsDark] = blocks(
  ":root\\[data-theme='dark'\\] \\[data-scope='landing'\\]",
);
const [docsDark] = blocks(":root\\[data-theme='dark'\\] \\[data-scope='docs'\\]");
const group = (name: string) =>
  tokens(
    new RegExp(`export const ${name} = stylex\\.defineVars\\(\\{([\\s\\S]*?)\\n\\}\\);`).exec(
      read('./tokens.stylex.ts'),
    )?.[1],
  );
const theme = (name: string) =>
  tokens(
    new RegExp(
      `export const ${name} = stylex\\.createTheme\\(colors, \\{([\\s\\S]*?)\\n\\}\\);`,
    ).exec(read('./themes.ts'))?.[1],
  );

/** The landing page's Night treatment re-points these in dark (D07). */
const NIGHT = [
  '--bg',
  '--ink',
  '--body',
  '--muted',
  '--rule',
  '--rule-strong',
  '--hover',
  '--btn',
  '--btn-ink',
];

describe('the colour tokens', () => {
  it('have a dark value for every light one, and no other', () => {
    expect(Object.keys(light).length).toBeGreaterThan(20);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    // Every dark value is a value, and the sets differ where a theme must.
    for (const [name, value] of Object.entries(dark)) {
      expect(value, name).not.toBe('');
    }
    expect(dark['--bg']).not.toBe(light['--bg']);
    expect(dark['--ink']).not.toBe(light['--ink']);
  });

  it("repeat exactly in the landing page's light scope", () => {
    expect(theme('landingLight')).toEqual(light);
  });

  it("repeat in the landing page's dark scope, but for the Night treatment's own", () => {
    expect(landingDark).toBeDefined();
    expect(Object.keys(landingDark!).sort()).toEqual(Object.keys(dark).sort());
    for (const name of Object.keys(dark)) {
      if (NIGHT.includes(name)) {
        expect(landingDark![name], name).not.toBe(dark[name]);
      } else {
        expect(landingDark![name], name).toBe(dark[name]);
      }
    }
  });

  it("give the landing page's cards and the docs dark values only for their own tokens", () => {
    const landing = group('landing');
    const docs = group('docs');
    expect(Object.keys(landingCardsDark!).length).toBeGreaterThan(10);
    expect(Object.keys(landingCardsDark!).sort()).toEqual(Object.keys(landing).sort());
    expect(Object.keys(docsDark!).length).toBeGreaterThan(10);
    expect(Object.keys(docsDark!).sort()).toEqual(Object.keys(docs).sort());
  });
});
