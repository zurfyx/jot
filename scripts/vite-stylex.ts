import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { transformAsync } from '@babel/core';
import stylexBabelPlugin from '@stylexjs/babel-plugin';
import { transform as lightningcss } from 'lightningcss';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * StyleX for Vite, with each page's CSS in its own chunk (D28).
 *
 * StyleX's Babel plugin compiles every module that imports
 * `@stylexjs/stylex`, and the module imports its own rules as a CSS file
 * (`<module>.stylex.css`). Vite's CSS code splitting then ships the rules with
 * the module's chunk: the landing page loads only its own styles, and the note
 * page's and the docs' arrive with their lazy chunks.
 *
 * The cascade. StyleX orders atomic rules by priority (a longhand beats a
 * shorthand, `:hover` beats the default, and so on). One stylesheet can carry
 * that order by position; several stylesheets that load in any order can't.
 * So every priority gets its own cascade layer, `stylex.p<priority>`, all
 * declared once, in priority order, by the first stylesheet the page loads
 * (`virtual:stylex-order.css`, imported first by main.tsx). A rule then wins
 * by its priority whatever stylesheet holds it and whenever it arrives.
 * Rules of the same priority keep StyleX's order inside a stylesheet.
 *
 * The build goes further: every rule ships exactly once. A rule the entry
 * chunk's modules use is in the entry stylesheet; a rule only one lazy
 * stylesheet needs is in that one; a rule two lazy stylesheets would share is
 * moved to the entry stylesheet. Rules of one priority and one property that
 * could meet on an element (two media queries, say) are kept together in one
 * stylesheet, in StyleX's order, so their relative order never depends on
 * which page loaded first.
 *
 * All of `src` is compiled once when the build or dev server starts, so the
 * set of priorities, and the layer order, is known before the first page loads.
 */

export const STYLEX_CSS_SUFFIX = '.stylex.css';
export const ORDER_CSS = 'virtual:stylex-order.css';
const LAYER_PREFIX = 'stylex.p';
/**
 * The build's stand-in for a module's rules, which generateBundle replaces:
 * a selector and a property of its own, so the CSS minifier merges no two.
 */
const MARKER = /\.jot-stylex-m(\d+)\{--jot-stylex-m\1:1\}/g;
/** Where the build records which stylesheet got each rule (for its tests). */
export const PLACEMENT_FILE = 'node_modules/.cache/jot-stylex/placement.json';

export type Rule = [string, { ltr: string; rtl?: string | null }, number];

interface Compiled {
  source: string;
  code: string;
  map: unknown;
  rules: Rule[];
}

/** The cascade layer of a priority; a priority must be a finite, non-negative number. */
export function layerName(priority: number): string {
  if (!Number.isFinite(priority) || priority < 0) {
    throw new Error(
      `StyleX emitted a rule with priority ${priority}; jot's plugin can't order it.`,
    );
  }
  return LAYER_PREFIX + String(priority).replace('.', '_');
}

/** The layer order: `reset` (globals.css) first, then every priority in ascending order. */
export function layerOrder(priorities: Iterable<number>): string {
  const sorted = [...new Set(priorities)].filter((p) => p > 0).sort((a, b) => a - b);
  return `@layer reset${sorted.map((p) => `, ${layerName(p)}`).join('')};\n`;
}

/**
 * Rules as CSS: one layer per priority, in ascending order, each in StyleX's
 * own order. Priority 0 (keyframes) stays unlayered, as StyleX leaves it.
 */
export function stylexCss(rules: readonly Rule[]): string {
  const byPriority = new Map<number, Rule[]>();
  for (const rule of rules) {
    layerName(rule[2]);
    byPriority.set(rule[2], [...(byPriority.get(rule[2]) ?? []), rule]);
  }
  return [...byPriority.keys()]
    .sort((a, b) => a - b)
    .map((priority) => {
      const css = stylexBabelPlugin.processStylexRules(byPriority.get(priority)! as never, {
        useLayers: false,
        legacyDisableLayers: true,
      });
      return priority > 0 ? `@layer ${layerName(priority)}{\n${css}\n}` : css;
    })
    .join('\n');
}

/**
 * A rule's condition: what is left of it without its class and declaration
 * (`:hover`, `@media (max-width: 640px)`, nothing for a plain rule).
 */
function condition(rule: Rule): string {
  const ltr = rule[1].ltr;
  return ltr
    .slice(0, ltr.lastIndexOf('{'))
    .replace(new RegExp(`\\.${rule[0]}(?![\\w-])`, 'g'), '')
    .trim();
}

/** The property a rule declares (`margin-top` in `.x{margin-top:4px}`). */
function declaredProperty(rule: Rule): string {
  const ltr = rule[1].ltr;
  const body = ltr.slice(ltr.lastIndexOf('{') + 1);
  return body.slice(0, body.indexOf(':')).trim();
}

function ruleKey(rule: Rule): string {
  return `${rule[0]}\n${rule[1].ltr}`;
}

/** Where StyleX puts each rule within its priority: its index in StyleX's own output. */
function stylexOrder(rules: readonly Rule[]): Map<string, number> {
  const order = new Map<string, number>();
  const byPriority = new Map<number, Rule[]>();
  for (const rule of rules) {
    byPriority.set(rule[2], [...(byPriority.get(rule[2]) ?? []), rule]);
  }
  for (const group of byPriority.values()) {
    const css = stylexBabelPlugin.processStylexRules(group as never, {
      useLayers: false,
      legacyDisableLayers: true,
    });
    for (const rule of group) {
      const at = new RegExp(`\\.${rule[0]}(?![\\w-])`).exec(css)?.index ?? css.indexOf(rule[1].ltr);
      order.set(ruleKey(rule), at);
    }
  }
  return order;
}

/**
 * Which stylesheet each rule ships in. `usedBy` maps a rule to the stylesheets
 * whose modules use it; `entry` is the stylesheet every page loads first.
 */
export function placeRules(
  usedBy: ReadonlyMap<string, { rule: Rule; sheets: ReadonlySet<string> }>,
  entry: string,
): Map<string, string> {
  const home = new Map<string, string>();
  for (const [key, { sheets }] of usedBy) {
    home.set(key, sheets.has(entry) || sheets.size !== 1 ? entry : [...sheets][0]!);
  }
  // Rules of one priority and property could meet on one element: their
  // relative order must not depend on the order pages load in.
  const all = [...usedBy.values()].map(({ rule }) => rule);
  const order = stylexOrder(all);
  const groups = new Map<string, Rule[]>();
  for (const rule of all) {
    const group = `${rule[2]}\n${declaredProperty(rule)}`;
    groups.set(group, [...(groups.get(group) ?? []), rule]);
  }
  for (const group of groups.values()) {
    // Same priority, same property, same condition: stylex.props gives an
    // element one class per property and condition, so they never meet.
    if (new Set(group.map(condition)).size < 2) {
      continue;
    }
    const sheets = new Set(group.map((rule) => home.get(ruleKey(rule))));
    if (sheets.size < 2) {
      continue;
    }
    const lazy = group.filter((rule) => home.get(ruleKey(rule)) !== entry);
    const early = group.filter((rule) => home.get(ruleKey(rule)) === entry);
    const lazySheets = new Set(lazy.map((rule) => home.get(ruleKey(rule))));
    const lastEarly = Math.max(...early.map((rule) => order.get(ruleKey(rule))!));
    const firstLazy = Math.min(...lazy.map((rule) => order.get(ruleKey(rule))!));
    // Entry rules load first, so a single lazy stylesheet whose rules all come
    // later in StyleX's order is safe; anything else goes to the entry.
    if (lazySheets.size > 1 || (early.length > 0 && lastEarly > firstLazy)) {
      for (const rule of lazy) {
        home.set(ruleKey(rule), entry);
      }
    }
  }
  return home;
}

function minify(css: string): string {
  return lightningcss({
    filename: 'stylex.css',
    code: Buffer.from(css),
    minify: true,
  }).code.toString();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function stylex({ rootDir, srcDir = 'src' }: { rootDir: string; srcDir?: string }): Plugin {
  const compiled = new Map<string, Compiled>();
  const priorities = new Set<number>();
  const moduleIds: string[] = [];
  let dev = false;
  let server: ViteDevServer | null = null;

  async function compile(code: string, id: string): Promise<Compiled | null> {
    const cached = compiled.get(id);
    if (cached?.source === code) {
      return cached;
    }
    const result = await transformAsync(code, {
      babelrc: false,
      configFile: false,
      filename: id,
      sourceMaps: true,
      parserOpts: { plugins: id.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'] },
      plugins: [
        [
          stylexBabelPlugin,
          {
            dev,
            runtimeInjection: false,
            treeshakeCompensation: true,
            unstable_moduleResolution: { type: 'commonJS', rootDir },
          },
        ],
      ],
    });
    if (result?.code == null) {
      return null;
    }
    const rules = (result.metadata as { stylex?: Rule[] } | undefined)?.stylex ?? [];
    const entry: Compiled = { source: code, code: result.code, map: result.map, rules };
    compiled.set(id, entry);
    if (!moduleIds.includes(id)) {
      moduleIds.push(id);
    }
    let added = false;
    for (const rule of rules) {
      layerName(rule[2]);
      if (!priorities.has(rule[2])) {
        priorities.add(rule[2]);
        added = true;
      }
    }
    // A new priority after the order was served: the page needs the new order.
    if (added && server !== null) {
      const order = server.moduleGraph.getModuleById(ORDER_CSS);
      if (order) {
        server.moduleGraph.invalidateModule(order);
        server.ws.send({ type: 'full-reload' });
      }
    }
    return entry;
  }

  function moduleCss(id: string): string {
    const entry = compiled.get(id);
    if (entry === undefined || entry.rules.length === 0) {
      return '';
    }
    const index = moduleIds.indexOf(id);
    return dev ? stylexCss(entry.rules) : `.jot-stylex-m${index}{--jot-stylex-m${index}:1}`;
  }

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
    async buildStart() {
      // The Worker's build has no styles to order.
      if (
        (this as { environment?: { config: { consumer: string } } }).environment?.config
          .consumer === 'server'
      ) {
        return;
      }
      for (const file of sourceFiles(join(rootDir, srcDir))) {
        const code = readFileSync(file, 'utf8');
        if (code.includes('@stylexjs/stylex')) {
          await compile(code, file);
        }
      }
    },
    resolveId(id) {
      return id === ORDER_CSS || id.endsWith(STYLEX_CSS_SUFFIX) ? id : null;
    },
    load(id) {
      if (id === ORDER_CSS) {
        return layerOrder(priorities);
      }
      return id.endsWith(STYLEX_CSS_SUFFIX)
        ? moduleCss(id.slice(0, -STYLEX_CSS_SUFFIX.length))
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
      const before = compiled.get(id)?.rules;
      const entry = await compile(code, id);
      if (entry === null) {
        return null;
      }
      const cssId = id + STYLEX_CSS_SUFFIX;
      if (before !== undefined && before !== entry.rules && server !== null) {
        const stale = server.moduleGraph.getModuleById(cssId);
        if (stale) {
          void server.reloadModule(stale);
        }
      }
      return {
        code:
          entry.rules.length === 0
            ? entry.code
            : `${entry.code}\nimport ${JSON.stringify(cssId)};\n`,
        map: entry.map as never,
      };
    },
    generateBundle(_options, bundle) {
      const sheets = Object.values(bundle).filter(
        (file) => file.type === 'asset' && file.fileName.endsWith('.css'),
      );
      const entryChunk = Object.values(bundle).find(
        (file) => file.type === 'chunk' && file.isEntry,
      );
      const entryCss =
        entryChunk?.type === 'chunk'
          ? [
              ...((entryChunk as { viteMetadata?: { importedCss: Set<string> } }).viteMetadata
                ?.importedCss ?? []),
            ][0]
          : undefined;
      // Which stylesheets use which rules, from the markers Vite bundled.
      const usedBy = new Map<string, { rule: Rule; sheets: Set<string> }>();
      for (const sheet of sheets) {
        if (sheet.type !== 'asset') continue;
        for (const [, index] of String(sheet.source).matchAll(MARKER)) {
          const id = moduleIds[Number(index)];
          for (const rule of id === undefined ? [] : (compiled.get(id)?.rules ?? [])) {
            const key = ruleKey(rule);
            const entry = usedBy.get(key) ?? { rule, sheets: new Set<string>() };
            entry.sheets.add(sheet.fileName);
            usedBy.set(key, entry);
          }
        }
      }
      if (usedBy.size === 0) {
        return;
      }
      if (entryCss === undefined) {
        this.error('jot:stylex found StyleX rules but no entry stylesheet to put shared ones in.');
      }
      for (const { rule } of usedBy.values()) {
        if (!priorities.has(rule[2]) && rule[2] > 0) {
          this.error(`jot:stylex: priority ${rule[2]} is missing from the declared layer order.`);
        }
      }
      const home = placeRules(usedBy, entryCss!);
      for (const sheet of sheets) {
        if (sheet.type !== 'asset') continue;
        const source = String(sheet.source);
        const first = source.search(MARKER);
        if (first < 0) continue;
        const rules = [...usedBy.values()]
          .map(({ rule }) => rule)
          .filter((rule) => home.get(ruleKey(rule)) === sheet.fileName);
        const css = rules.length === 0 ? '' : minify(stylexCss(rules));
        const rest = source.replace(MARKER, '');
        sheet.source = rest.slice(0, first) + css + rest.slice(first);
      }
      const file = join(rootDir, PLACEMENT_FILE);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          entry: entryCss,
          rules: [...usedBy.entries()].map(([key, { rule, sheets: used }]) => ({
            key,
            priority: rule[2],
            usedBy: [...used].sort(),
            home: home.get(key),
          })),
        }),
      );
    },
  };
}
