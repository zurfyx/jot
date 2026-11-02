import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';

/**
 * The production build, as Cloudflare serves it: `pnpm build`, then the built
 * Worker and its static assets in wrangler dev (playwright.config.ts, D31),
 * prerendered pages, 404 page and all. Tests may slow or hold some of its
 * files on the way. Note pages render, but their socket never connects.
 */
export const ORIGIN = `http://127.0.0.1:${Number(process.env.JOT_E2E_PORT ?? 5174) + 1}`;
export const CLIENT = join(import.meta.dirname, '../../dist/client');

/** Opens the build in `target`; `delays` slow matching files by so many ms, `hold` holds them. */
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
    if (options.hold?.test(path)) {
      await held;
    }
    const delay = options.delays?.find(([pattern]) => pattern.test(path))?.[1];
    if (delay !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await route.continue();
  });
  return { release };
}

/** The entry script the prerendered landing page loads. */
export function entryScript(): string {
  const html = readFileSync(join(CLIENT, 'index.html'), 'utf8');
  const match = /<script type="module"[^>]* src="\/(assets\/index-[\w-]+\.js)"/.exec(html);
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
