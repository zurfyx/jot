import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

/**
 * The production build, served to the browser from dist/client by the test
 * itself (no server, no Worker): every request to ORIGIN is answered from the
 * built files, and paths without a file get index.html, as the Worker's
 * assets do. Note pages render, but their socket never connects.
 */
export const ORIGIN = 'http://jot.test';
export const CLIENT = join(import.meta.dirname, '../../dist/client');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface Hold {
  /** Requests whose path matches are held until `release()`. */
  pattern: RegExp;
  release(): void;
}

/** Serves the build to `target`; `delays` hold matching files for so many ms. */
export async function serveBuild(
  target: Page | BrowserContext,
  options: { delays?: [RegExp, number][]; hold?: RegExp } = {},
): Promise<{ release(): void }> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await target.routeWebSocket(/.*/, () => {
    // The relay never answers: a note page stays "Connecting…".
  });
  await target.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/')) {
      await route.abort();
      return;
    }
    const file = join(CLIENT, path);
    const found = path !== '/' && existsSync(file) && statSync(file).isFile();
    const body = readFileSync(found ? file : join(CLIENT, 'index.html'));
    if (options.hold?.test(path)) {
      await held;
    }
    const delay = options.delays?.find(([pattern]) => pattern.test(path))?.[1];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': TYPES[extname(found ? file : 'index.html')] ?? 'text/plain' },
    });
  });
  return { release };
}

/** The entry script index.html loads. */
export function entryScript(): string {
  const html = readFileSync(join(CLIENT, 'index.html'), 'utf8');
  const match = /<script type="module" crossorigin src="\/(assets\/index-[\w-]+\.js)"/.exec(html);
  if (match === null) {
    throw new Error('dist/client/index.html loads no entry script.');
  }
  return match[1]!;
}

/** Moves the app to `path` the way its own links do, without a reload. */
export function navigateInApp(page: Page, path: string): Promise<void> {
  return page.evaluate((to) => {
    window.history.pushState(null, '', to);
    window.dispatchEvent(new Event('jot:navigate'));
  }, path);
}
