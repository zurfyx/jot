import { describe, expect, it } from 'vitest';
import { previewConfig } from './preview-config.mjs';

// The shape `CLOUDFLARE_ENV=preview pnpm build` writes to dist/jot/wrangler.json.
function built(overrides = {}) {
  return {
    configPath: '/repo/wrangler.jsonc',
    topLevelName: 'jot',
    targetEnvironment: 'preview',
    compatibility_date: '2026-10-25',
    compatibility_flags: [],
    rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
    name: 'jot-preview',
    main: 'index.js',
    routes: [],
    triggers: {},
    assets: {
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*', '/n/*'],
      directory: '../client',
    },
    workers_dev: true,
    preview_urls: false,
    vars: {},
    durable_objects: { bindings: [{ name: 'NOTES', class_name: 'NoteRoom' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['NoteRoom'] }],
    kv_namespaces: [],
    queues: { producers: [], consumers: [] },
    services: [],
    logfwdr: { bindings: [] },
    upload_source_maps: true,
    observability: { enabled: true },
    dev: { ip: 'localhost' },
    no_bundle: true,
    ...overrides,
  };
}

describe('previewConfig', () => {
  it('deploys the named Worker on workers.dev only, with its own namespace', () => {
    expect(previewConfig(built(), 'jot-pr-12')).toEqual({
      name: 'jot-pr-12',
      main: 'index.js',
      no_bundle: true,
      rules: [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
      compatibility_date: '2026-10-25',
      compatibility_flags: [],
      upload_source_maps: true,
      observability: { enabled: true },
      assets: built().assets,
      routes: [],
      workers_dev: true,
      preview_urls: false,
      durable_objects: { bindings: [{ name: 'NOTES', class_name: 'NoteRoom' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['NoteRoom'] }],
    });
  });

  it.each([
    ['production', 'jot'],
    ['an empty name', ''],
    ['another Worker', 'koala-game'],
    ['a suffixed name', 'jot-pr-12-x'],
  ])('refuses %s', (_, worker) => {
    expect(() => previewConfig(built(), worker)).toThrow(/not a preview Worker name/);
  });

  it('refuses a production build', () => {
    expect(() => previewConfig(built({ targetEnvironment: undefined }), 'jot-pr-1')).toThrow(
      /CLOUDFLARE_ENV=preview/,
    );
  });

  it('refuses routes', () => {
    const routes = [{ pattern: 'jot.rovira.sh', custom_domain: true }];
    expect(() => previewConfig(built({ routes }), 'jot-pr-1')).toThrow(/routes/);
    expect(() => previewConfig(built({ route: 'jot.rovira.sh/*' }), 'jot-pr-1')).toThrow(/routes/);
  });

  it.each([
    [
      'transferred',
      {
        tag: 'v1',
        transferred_classes: [{ from: 'NoteRoom', from_script: 'jot', to: 'NoteRoom' }],
      },
    ],
    ['renamed', { tag: 'v1', renamed_classes: [{ from: 'NoteRoom', to: 'Room' }] }],
    ['deleted', { tag: 'v1', deleted_classes: ['NoteRoom'] }],
    ['extra', { tag: 'v1', new_sqlite_classes: ['NoteRoom'], transferred_classes: [] }],
  ])('refuses %s classes in migrations', (_, migration) => {
    expect(() => previewConfig(built({ migrations: [migration] }), 'jot-pr-1')).toThrow(
      /migrations must be exactly/,
    );
  });

  it('refuses a Durable Object binding into another script', () => {
    const durable_objects = {
      bindings: [{ name: 'NOTES', class_name: 'NoteRoom', script_name: 'jot' }],
    };
    expect(() => previewConfig(built({ durable_objects }), 'jot-pr-1')).toThrow(/Durable Objects/);
  });

  it('refuses any other binding or trigger', () => {
    for (const extra of [
      { services: [{ binding: 'PROD', service: 'jot' }] },
      { kv_namespaces: [{ binding: 'KV', id: 'x' }] },
      { vars: { MODE: 'prod' } },
      { triggers: { crons: ['* * * * *'] } },
      { tail_consumers: [{ service: 'jot' }] },
    ]) {
      expect(() => previewConfig(built(extra), 'jot-pr-1')).toThrow(/unexpected/);
    }
  });

  it('refuses unexpected asset settings', () => {
    const assets = { ...built().assets, binding: 'FILES' };
    expect(() => previewConfig(built({ assets }), 'jot-pr-1')).toThrow(/ASSETS/);
  });
});
