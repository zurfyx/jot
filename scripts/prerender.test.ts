import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * scripts/prerender.ts fails the build when a page doesn't render (D31): a
 * render error React would leave for the browser, or a page without its
 * content. Each case runs the script on a small stand-in for the client build.
 */

const ROOT = join(import.meta.dirname, '..');
const dirs: string[] = [];

/** The least of a client build the script reads: the shell, the manifest and the font. */
function clientBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jot-prerender-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, '.vite'));
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html>\n<html lang="en">\n  <head>\n    <title>jot</title>\n    <meta name="description" content="jot" />\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n',
  );
  writeFileSync(
    join(dir, '.vite/manifest.json'),
    JSON.stringify({
      'src/client/docs/DocsPage.tsx': {
        file: 'assets/DocsPage-test.js',
        css: ['assets/DocsPage-test.css'],
      },
    }),
  );
  writeFileSync(join(dir, 'assets/geist-latin-wght-normal-test.woff2'), '');
  return dir;
}

function prerender(client: string, entry?: string, broken?: string) {
  return spawnSync(
    process.execPath,
    [
      'scripts/prerender.ts',
      `--client=${client}`,
      ...(entry === undefined ? [] : [`--entry=${entry}`]),
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...(broken === undefined ? {} : { JOT_BROKEN: broken }) },
    },
  );
}

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the prerender (D31)', () => {
  it('writes every page with its content', { timeout: 60_000 }, () => {
    const client = clientBuild();
    const result = prerender(client);
    // A warning on stderr (a slow plugin, under load) is no failure.
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(client, 'docs/blame/index.html'), 'utf8')).toContain(
      'Blame and history',
    );
    expect(readFileSync(join(client, 'n/shell.html'), 'utf8')).toContain(
      'jot needs JavaScript to edit notes.',
    );
    // And what crawlers and assistants read (D32).
    expect(readFileSync(join(client, 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://jot.rovira.sh/sitemap.xml',
    );
    expect(readFileSync(join(client, '_headers'), 'utf8')).toContain(
      '/sitemap.xml\n  Content-Type: application/xml; charset=utf-8',
    );
    expect(readFileSync(join(client, 'sitemap.xml'), 'utf8')).toContain(
      '<loc>https://jot.rovira.sh/docs/blame</loc>',
    );
    expect(readFileSync(join(client, 'llms.txt'), 'utf8')).toContain(
      '(https://jot.rovira.sh/docs/blame.md)',
    );
    expect(readFileSync(join(client, 'docs/blame.md'), 'utf8')).toContain('# Blame and history');
    expect(readFileSync(join(client, 'llms-full.txt'), 'utf8')).toContain('# Blame and history');
    expect(readFileSync(join(client, '_headers'), 'utf8')).toContain(
      '/docs/blame.md\n  Content-Type: text/markdown; charset=utf-8',
    );
  });

  it('fails the build when a page throws while it renders', { timeout: 60_000 }, () => {
    const client = clientBuild();
    const result = prerender(client, 'scripts/fixtures/prerender-broken.tsx', 'throws');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('a page that throws while it renders');
    // Nothing was written.
    expect(() => readFileSync(join(client, 'docs/blame/index.html'))).toThrow();
  });

  it('fails the build when a page renders without its content', { timeout: 60_000 }, () => {
    const client = clientBuild();
    const result = prerender(client, 'scripts/fixtures/prerender-broken.tsx', 'empty');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('/docs/blame does not say "Blame and history"');
  });
});
