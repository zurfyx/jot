import { describe, expect, it } from 'vitest';

import {
  layerName,
  layerOrder,
  placeRules,
  type Rule,
  STYLEX_CSS_SUFFIX,
  stylex,
  stylexCss,
} from './vite-stylex.ts';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** The plugin's hooks, called as Vite would. */
function plugin(command: 'serve' | 'build') {
  const instance = stylex({ rootDir: '/repo', srcDir: 'nowhere' });
  const call = (name: 'transform' | 'load' | 'resolveId', ...args: unknown[]) =>
    (instance[name] as Hook).call({}, ...args);
  (instance.configResolved as Hook).call({}, { command });
  return { call };
}

const MODULE = `
import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({
  box: { margin: 0, marginTop: 4, color: { default: 'red', ':hover': 'blue' } },
});
export const Box = () => <div {...stylex.props(styles.box)} />;
`;

function rule(name: string, css: string, priority: number): Rule {
  return [name, { ltr: css, rtl: null }, priority];
}

describe('compiling modules', () => {
  it('compiles a module, which imports its own rules, layered by priority', async () => {
    const { call } = plugin('serve');
    const result = (await call('transform', MODULE, '/repo/src/Box.tsx')) as { code: string };
    expect(result.code).not.toContain('stylex.create');
    const id = `/repo/src/Box.tsx${STYLEX_CSS_SUFFIX}`;
    expect(result.code).toContain(`import "${id}";`);
    expect(call('resolveId', id)).toBe(id);
    const css = call('load', id) as string;
    expect(css).toMatch(/@layer stylex\.p1000\{[^}]*margin:0/);
    expect(css).toMatch(/@layer stylex\.p4000\{[^}]*margin-top:4px/);
    expect(css).toMatch(/@layer stylex\.p3130\{[^}]*:hover/);
    expect(css).not.toContain(':not(#');
    // The order: reset, then every priority the modules use, ascending.
    expect(call('load', 'virtual:stylex-order.css')).toBe(
      '@layer reset, stylex.p1000, stylex.p3000, stylex.p3130, stylex.p4000;\n',
    );
  });

  it('puts a marker in the build, for generateBundle to replace', async () => {
    const { call } = plugin('build');
    await call('transform', MODULE, '/repo/src/Box.tsx');
    expect(call('load', `/repo/src/Box.tsx${STYLEX_CSS_SUFFIX}`)).toBe(
      '.jot-stylex-m0{--jot-stylex-m0:1}',
    );
  });

  it('leaves modules without StyleX, and node_modules, alone', async () => {
    const { call } = plugin('serve');
    expect(await call('transform', 'export const a = 1;', '/repo/src/a.ts')).toBeNull();
    expect(await call('transform', MODULE, '/repo/node_modules/x/Box.tsx')).toBeNull();
  });
});

describe('the layer order', () => {
  it('declares reset, then every priority ascending, whatever it is', () => {
    expect(layerOrder([4000, 3130, 0, 12000, 3010.4, 3000])).toBe(
      '@layer reset, stylex.p3000, stylex.p3010_4, stylex.p3130, stylex.p4000, stylex.p12000;\n',
    );
  });

  it('fails loudly on a priority it can not order', () => {
    expect(() => layerName(Number.NaN)).toThrow(/priority NaN/);
    expect(() => layerName(-1)).toThrow(/priority -1/);
    expect(() => layerName(Infinity)).toThrow(/priority Infinity/);
    expect(() => stylexCss([rule('x', '.x{color:red}', Number.NaN)])).toThrow();
  });

  it('wraps each priority in its layer, and leaves keyframes unlayered', () => {
    const css = stylexCss([
      rule('b', '.b{margin-top:4px}', 4000),
      rule('k', '@keyframes k{from{opacity:0}}', 0),
      rule('a', '.a{margin:0}', 2000),
      rule('h', '.h:hover{color:blue}', 3130),
    ]);
    const order = ['@keyframes k', 'stylex.p2000{', 'stylex.p3130{', 'stylex.p4000{'].map((part) =>
      css.indexOf(part),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(css).not.toMatch(/@layer [^{]*\{\s*@keyframes/);
    expect(stylexCss([])).toBe('');
  });
});

describe('placing rules in the build', () => {
  const ENTRY = 'index.css';
  const used = (...entries: [Rule, string[]][]) =>
    new Map(
      entries.map(([r, sheets]) => [`${r[0]}\n${r[1].ltr}`, { rule: r, sheets: new Set(sheets) }]),
    );
  const homes = (map: Map<string, string>) =>
    Object.fromEntries([...map].map(([key, home]) => [key.split('\n')[0], home]));

  it('ships each rule once: in the entry if it uses it, else in its one sheet, else in the entry', () => {
    const placed = placeRules(
      used(
        [rule('a', '.a{color:red}', 3000), [ENTRY, 'note.css']],
        [rule('b', '.b{color:blue}', 3000), ['note.css']],
        [rule('c', '.c{margin:0}', 2000), ['note.css', 'docs.css']],
      ),
      ENTRY,
    );
    expect(homes(placed)).toEqual({ a: ENTRY, b: 'note.css', c: ENTRY });
  });

  it('keeps rules of one priority and property with different conditions in one order', () => {
    // Two media queries on one property, in two lazy sheets: either could load first.
    const wide = rule('w', '@media (max-width: 900px){.w.w{padding:4px}}', 3200);
    const narrow = rule('n', '@media (max-width: 640px){.n.n{padding:2px}}', 3200);
    expect(homes(placeRules(used([wide, ['note.css']], [narrow, ['docs.css']]), ENTRY))).toEqual({
      w: ENTRY,
      n: ENTRY,
    });
    // In one lazy sheet, they stay there together.
    expect(homes(placeRules(used([wide, ['note.css']], [narrow, ['note.css']]), ENTRY))).toEqual({
      w: 'note.css',
      n: 'note.css',
    });
  });

  it('leaves same-condition rules of one property where they are', () => {
    const placed = placeRules(
      used(
        [rule('r', '.r{color:red}', 3000), ['note.css']],
        [rule('b', '.b{color:blue}', 3000), ['docs.css']],
      ),
      ENTRY,
    );
    expect(homes(placed)).toEqual({ r: 'note.css', b: 'docs.css' });
  });
});
