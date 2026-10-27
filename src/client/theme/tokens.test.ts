/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Read as files: CSS imported in a test is left out by Vitest.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const tokens = read('./tokens.stylex.ts');
const globals = read('../globals.css');

/**
 * The colour tokens' light values are StyleX variables (tokens.stylex.ts);
 * their dark values are in globals.css, where they apply before the first
 * paint (D28). The two lists must name the same tokens.
 */
function names(block: string): string[] {
  return [...block.matchAll(/['"]?(--[\w-]+)['"]?\s*:/g)].map(([, name]) => name!).sort();
}

describe('the colour tokens', () => {
  const light = /export const colors = stylex\.defineVars\(\{([\s\S]*?)\n\}\);/.exec(tokens)?.[1];
  const dark = /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(globals)?.[1];

  it('have a dark value for every light one, and no other', () => {
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(names(dark!)).toEqual(names(light!));
    expect(names(light!).length).toBeGreaterThan(20);
  });
});
