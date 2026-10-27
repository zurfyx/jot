/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The colour tokens (D28). Their light values are StyleX variables
 * (tokens.stylex.ts); their dark values are in globals.css, where they apply
 * before the first paint; the landing page repeats both sets in its scopes
 * (themes.ts), re-pointing only the Night treatment's tokens in dark.
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
const dark = tokens(
  /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(read('../globals.css'))?.[1],
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
    const landingDark = theme('landingDark');
    expect(Object.keys(landingDark).sort()).toEqual(Object.keys(dark).sort());
    for (const name of Object.keys(dark)) {
      if (NIGHT.includes(name)) {
        expect(landingDark[name], name).not.toBe(dark[name]);
      } else {
        expect(landingDark[name], name).toBe(dark[name]);
      }
    }
  });
});
