import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { CLIENT } from './serve';

/**
 * The built CSS (D28): which stylesheet holds which StyleX rules. Read from
 * the build and from the plugin's record of where it put each rule
 * (node_modules/.cache/jot-stylex/placement.json), so a StyleX upgrade that
 * changes its output, or a change to scripts/vite-stylex.ts, shows here.
 */
interface Placement {
  entry: string;
  rules: { key: string; priority: number; usedBy: string[]; home: string }[];
}

const placement = (): Placement =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../node_modules/.cache/jot-stylex/placement.json'),
      'utf8',
    ),
  ) as Placement;

const sheets = () =>
  Object.fromEntries(
    readdirSync(join(CLIENT, 'assets'))
      .filter((file) => file.endsWith('.css'))
      .map((file) => [`assets/${file}`, readFileSync(join(CLIENT, 'assets', file), 'utf8')]),
  );

/** Where a rule's own name appears: `.x1abc` in a selector, `@keyframes x1abc-B`. */
function mentions(css: string, name: string): boolean {
  return new RegExp(`(?:\\.|@keyframes )${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css);
}

test('every StyleX rule ships once, in the stylesheet the build chose', () => {
  const { rules } = placement();
  const css = sheets();
  expect(rules.length).toBeGreaterThan(500);
  for (const { key, home } of rules) {
    const name = key.split('\n')[0]!;
    const holders = Object.keys(css).filter((sheet) => mentions(css[sheet]!, name));
    expect(holders, name).toEqual([home]);
  }
  // No marker is left behind.
  for (const [sheet, text] of Object.entries(css)) {
    expect(text, sheet).not.toContain('jot-stylex-m');
  }
});

test('each page has its own rules: the landing page loads no rule only a lazy page uses', () => {
  const { entry, rules } = placement();
  const homes = new Map<string, number>();
  for (const { home } of rules) {
    homes.set(home, (homes.get(home) ?? 0) + 1);
  }
  // The note page's and the docs' own rules ship in their chunks.
  const lazy = [...homes].filter(([sheet]) => sheet !== entry);
  expect(lazy.find(([sheet]) => sheet.includes('NotePage-'))?.[1]).toBeGreaterThan(50);
  expect(lazy.find(([sheet]) => sheet.includes('DocsPage-'))?.[1]).toBeGreaterThan(20);
  // A rule in the entry that no entry module uses was moved there because
  // two lazy stylesheets need it, or to keep a property's order.
  const moved = rules.filter(({ home, usedBy }) => home === entry && !usedBy.includes(entry));
  expect(moved.length).toBeLessThan(rules.length / 5);
});

test('the entry stylesheet orders every layer, by priority, before a lazy one uses it', () => {
  const { entry, rules } = placement();
  const css = sheets();
  // Layers are ordered by first appearance, in a statement or a block (the
  // minifier is free to turn one into the other).
  const declared: string[] = [];
  for (const [, names] of css[entry]!.matchAll(/@layer ([\w., ]+)[;{]/g)) {
    for (const name of names!.split(',').map((part) => part.trim())) {
      if (!declared.includes(name)) declared.push(name);
    }
  }
  expect(declared[0]).toBe('reset');
  const priorities = declared.slice(1).map((name) => Number(name.slice(8).replace('_', '.')));
  expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  for (const { priority } of rules) {
    if (priority > 0) {
      expect(priorities, String(priority)).toContain(priority);
    }
  }
  // Every layer any stylesheet uses is already in the entry's order.
  for (const [sheet, text] of Object.entries(css)) {
    for (const [, name] of text.matchAll(/@layer ([\w.]+)\{/g)) {
      expect(declared, `${sheet}: ${name}`).toContain(name);
    }
  }
  // And the whole order is in place before the entry's first StyleX rule.
  const firstUse = css[entry]!.search(/@layer stylex\.[\w]+\{/);
  const lastPriority = `stylex.p${String(priorities.at(-1)).replace('.', '_')}`;
  expect(css[entry]!.indexOf(lastPriority)).toBeLessThan(firstUse);
});
