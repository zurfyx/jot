import { transformAsync } from '@babel/core';
import stylexBabelPlugin from '@stylexjs/babel-plugin';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * StyleX for Vite, with each page's CSS in its own chunk (D28).
 *
 * The StyleX Babel plugin compiles every module that imports
 * `@stylexjs/stylex`; the module then imports its own rules as a CSS file
 * (`<module>.stylex.css`, served from memory). Vite's CSS code splitting puts
 * that CSS in the chunk of the module that imports it, so the landing page
 * loads only the landing page's styles, and the note page's and the docs'
 * arrive with their lazy chunks.
 *
 * StyleX orders its atomic rules by priority level. In one stylesheet it
 * raises each level's specificity with `:not(#\#)`, counting the levels the
 * stylesheet holds; with one stylesheet per module that count would differ
 * between stylesheets. Every module's rules are therefore processed with a
 * placeholder rule at every level, so a level always gets the same
 * specificity, and the placeholders are dropped from the output. The order
 * the stylesheets load in then never matters.
 */

export const STYLEX_CSS_SUFFIX = '.stylex.css';

/** StyleX's priority levels (priority / 1000): more than its rules use. */
const LEVELS = 10;
const PLACEHOLDER = /^\.jot-stylex-level-\d+(?::not\(#\\#\))*\{\}$/;

type Rule = [string, { ltr: string; rtl?: string | null }, number];

/** A module's rules as CSS, with every level at the same specificity in every module. */
export function stylexCss(rules: readonly Rule[]): string {
  if (rules.length === 0) {
    return '';
  }
  const placeholders: Rule[] = Array.from({ length: LEVELS }, (_, level) => [
    `jot-stylex-level-${level}`,
    { ltr: `.jot-stylex-level-${level}{}`, rtl: null },
    level * 1000,
  ]);
  const css = stylexBabelPlugin.processStylexRules([...rules, ...placeholders] as never, {
    useLayers: false,
  });
  return css
    .split('\n')
    .filter((line) => !PLACEHOLDER.test(line))
    .join('\n');
}

export function stylex({ rootDir }: { rootDir: string }): Plugin {
  const cssByModule = new Map<string, string>();
  let dev = false;
  let server: ViteDevServer | null = null;

  return {
    name: 'jot:stylex',
    // Before React's plugin, which must see the compiled code.
    enforce: 'pre',
    configResolved(config) {
      dev = config.command === 'serve';
    },
    configureServer(devServer) {
      server = devServer;
    },
    resolveId(id) {
      return id.endsWith(STYLEX_CSS_SUFFIX) ? id : null;
    },
    load(id) {
      return id.endsWith(STYLEX_CSS_SUFFIX)
        ? (cssByModule.get(id.slice(0, -STYLEX_CSS_SUFFIX.length)) ?? '')
        : null;
    },
    async transform(code, id) {
      if (
        !/\.[cm]?[jt]sx?$/.test(id) ||
        id.includes('/node_modules/') ||
        !code.includes('@stylexjs/stylex')
      ) {
        return null;
      }
      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
        sourceMaps: true,
        parserOpts: { plugins: id.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'] },
        plugins: [
          // StyleX's types are for Babel 7's; the plugin runs on Babel 8 as is.
          stylexBabelPlugin.withOptions({
            dev,
            runtimeInjection: false,
            treeshakeCompensation: true,
            unstable_moduleResolution: { type: 'commonJS', rootDir },
          }) as never,
        ],
      });
      if (result?.code == null) {
        return null;
      }
      const rules = (result.metadata as { stylex?: Rule[] } | undefined)?.stylex ?? [];
      const css = stylexCss(rules);
      const cssId = id + STYLEX_CSS_SUFFIX;
      if (cssByModule.get(id) !== css) {
        cssByModule.set(id, css);
        const stale = server?.moduleGraph.getModuleById(cssId);
        if (stale) {
          void server!.reloadModule(stale);
        }
      }
      return {
        code: css === '' ? result.code : `${result.code}\nimport ${JSON.stringify(cssId)};\n`,
        map: result.map as never,
      };
    },
  };
}
