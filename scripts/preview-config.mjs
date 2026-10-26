// Builds the exact Wrangler config a PR preview deploys (D10), from the config
// `CLOUDFLARE_ENV=preview pnpm build` writes to dist/jot/wrangler.json.
//
//   node scripts/preview-config.mjs dist/jot/wrangler.json jot-pr-12
//
// writes dist/jot/wrangler.preview.json next to it, and CI deploys that file.
// Nothing safety-relevant is copied from the build: the name, routes,
// workers.dev, the Durable Object binding and the migrations are constants
// here. The build only contributes the bundle settings below, and anything
// else it carries (another binding, a cron, a transferred class) fails the
// deploy rather than being dropped silently.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_NAME = /^jot-pr-[0-9]+$/;

// The only binding a preview has besides ASSETS: its own namespace for its own
// class. No script_name, so it can never reach production's namespace.
const DURABLE_OBJECTS = { bindings: [{ name: 'NOTES', class_name: 'NoteRoom' }] };
// The only migration a preview runs: create its own class, fresh. No
// transferred, renamed or deleted classes.
const MIGRATIONS = [{ tag: 'v1', new_sqlite_classes: ['NoteRoom'] }];

// Bundle and runtime settings, copied as built.
const COPIED = [
  'main',
  'no_bundle',
  'rules',
  'compatibility_date',
  'compatibility_flags',
  'jsx_factory',
  'jsx_fragment',
  'upload_source_maps',
  'observability',
];
const ASSETS_KEYS = [
  'binding',
  'directory',
  'not_found_handling',
  'html_handling',
  'run_worker_first',
];
// Build metadata and local dev settings, not deployed.
const IGNORED = [
  'configPath',
  'userConfigPath',
  'topLevelName',
  'definedEnvironments',
  'targetEnvironment',
  'dev',
  'python_modules',
];
// Replaced by constants, after checking the build agrees with them.
const REPLACED = ['name', 'routes', 'workers_dev', 'preview_urls', 'durable_objects', 'migrations'];

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every(isEmpty);
  return false;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * @param {Record<string, unknown>} built dist/jot/wrangler.json from a preview build
 * @param {string} worker jot-pr-<number>
 */
export function previewConfig(built, worker) {
  const fail = (why) => {
    throw new Error(`Refusing to deploy ${worker}: ${why}`);
  };
  if (!WORKER_NAME.test(worker)) fail('not a preview Worker name');
  if (built.targetEnvironment !== 'preview') fail('not built with CLOUDFLARE_ENV=preview');
  if (!isEmpty(built.routes) || built.route != null) fail('the build has routes');
  if (!same(built.durable_objects, DURABLE_OBJECTS)) {
    fail(`Durable Objects must be exactly ${JSON.stringify(DURABLE_OBJECTS)}`);
  }
  if (!same(built.migrations, MIGRATIONS)) {
    fail(`migrations must be exactly ${JSON.stringify(MIGRATIONS)}`);
  }
  const assets = /** @type {Record<string, unknown>} */ (built.assets);
  if (assets?.binding !== 'ASSETS') fail('assets must bind ASSETS');
  for (const key of Object.keys(assets)) {
    if (!ASSETS_KEYS.includes(key)) fail(`unexpected assets.${key}`);
  }
  for (const [key, value] of Object.entries(built)) {
    const known = [...COPIED, ...IGNORED, ...REPLACED, 'assets'].includes(key);
    if (!known && !isEmpty(value)) fail(`unexpected ${key}: ${JSON.stringify(value)}`);
  }

  const config = { name: worker };
  for (const key of COPIED) if (built[key] !== undefined) config[key] = built[key];
  return {
    ...config,
    assets,
    routes: [],
    workers_dev: true,
    preview_urls: false,
    durable_objects: DURABLE_OBJECTS,
    migrations: MIGRATIONS,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, worker] = process.argv.slice(2);
  if (!input || !worker) {
    console.error('usage: node scripts/preview-config.mjs <dist/jot/wrangler.json> <jot-pr-N>');
    process.exit(2);
  }
  try {
    const config = previewConfig(JSON.parse(readFileSync(input, 'utf8')), worker);
    const output = join(dirname(input), 'wrangler.preview.json');
    writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Wrote ${output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
