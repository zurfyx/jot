import { describe, expect, it } from 'vitest';

import { STYLEX_CSS_SUFFIX, stylex, stylexCss } from './vite-stylex.ts';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** The plugin's hooks, called as Vite would for a build. */
function plugin() {
  const instance = stylex({ rootDir: '/repo' });
  const call = (name: 'transform' | 'load' | 'resolveId', ...args: unknown[]) =>
    (instance[name] as Hook).call({}, ...args);
  (instance.configResolved as Hook).call({}, { command: 'build' });
  return { call };
}

const MODULE = `
import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({
  box: { margin: 0, marginTop: 4, color: { default: 'red', ':hover': 'blue' } },
});
export const Box = () => <div {...stylex.props(styles.box)} />;
`;

describe('StyleX, each module with its own CSS', () => {
  it('compiles a module and makes it import its own rules', async () => {
    const { call } = plugin();
    const result = (await call('transform', MODULE, '/repo/src/Box.tsx')) as { code: string };
    expect(result.code).not.toContain('stylex.create');
    expect(result.code).toContain(`import "/repo/src/Box.tsx${STYLEX_CSS_SUFFIX}";`);
    const id = `/repo/src/Box.tsx${STYLEX_CSS_SUFFIX}`;
    expect(call('resolveId', id)).toBe(id);
    const css = call('load', id) as string;
    expect(css).toMatch(/margin:0/);
    expect(css).toMatch(/margin-top:4px/);
    expect(css).toMatch(/:hover/);
    expect(css).not.toContain('jot-stylex-level');
  });

  it('leaves modules without StyleX, and node_modules, alone', async () => {
    const { call } = plugin();
    expect(await call('transform', 'export const a = 1;', '/repo/src/a.ts')).toBeNull();
    expect(await call('transform', MODULE, '/repo/node_modules/x/Box.tsx')).toBeNull();
  });

  it('gives a priority level the same specificity in every module', () => {
    // A longhand alone in one module, a shorthand and a longhand in another:
    // the longhand must outrank the shorthand whichever stylesheet loads last.
    const longhand = ['a', { ltr: '.a{margin-top:4px}' }, 4000] as const;
    const shorthand = ['b', { ltr: '.b{margin:0}' }, 1000] as const;
    const alone = stylexCss([longhand as never]);
    const both = stylexCss([shorthand as never, longhand as never]);
    const selector = (css: string, name: string) =>
      css.split('\n').find((line) => line.startsWith(`.${name}`));
    expect(selector(alone, 'a')).toBe(selector(both, 'a'));
    expect(selector(alone, 'a')).toContain(':not(#\\#)');
    expect(selector(both, 'b')).not.toBe(selector(both, 'a'));
    expect(stylexCss([])).toBe('');
  });
});
