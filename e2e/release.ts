import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIN_LAYOUT } from '@lexical/y';
import {
  type Browser,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import * as Y from '@y/y';

import { layout1Note, type LAYOUT1_NOTES } from '../src/shared/testing/layout1';
import { expect } from './helpers';
import { writeRawNote } from './raw-client';

/**
 * Helpers for tests that run a release change end to end (D34): another
 * jot build's pages served to a browser, a note's floor raised, a layout 1
 * note written as an earlier release stored it.
 */

/**
 * The layout a migration takes a layout 1 note to: this build's floor once a
 * release raises it (3 with identity's layout 3), else 2 (the 1to2 step,
 * through the development-only test setting).
 */
export const TARGET = Math.max(MIN_LAYOUT, 2);

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/**
 * A browser for pages of another build. A page whose document a route
 * fulfilled has no address space, so Chromium's local network access checks
 * block its socket to this (loopback) server; this browser runs without them.
 */
export async function otherBuildBrowser(
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<Browser> {
  const args = ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'];
  if (process.env.JOT_E2E_SINGLE_PROCESS) {
    args.push('--single-process');
  }
  return playwright.chromium.launch({ args });
}

/**
 * Serves another build's note page and assets (its `dist/client`) to `page`
 * while `active()` holds; the API stays this server's. When it stops holding,
 * the page loads this build: as a reload after a deploy does.
 */
export async function serveBuild(page: Page, dist: string, active: () => boolean = () => true) {
  await page.route(
    (url) => /^\/(n\/[\w-]{22}$|assets\/)/.test(url.pathname),
    async (route) => {
      if (!active()) {
        await route.fallback();
        return;
      }
      const path = new URL(route.request().url()).pathname;
      const file = path.startsWith('/n/') ? join(dist, 'n', 'shell.html') : join(dist, path);
      if (!existsSync(file)) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      const ext = file.slice(file.lastIndexOf('.'));
      await route.fulfill({
        body: readFileSync(file),
        contentType: TYPES[ext] ?? 'application/octet-stream',
      });
    },
  );
}

/** Sets a note's floor for the Worker (development-only test settings). */
export async function setFloor(baseURL: string, id: string, floor: number) {
  const response = await fetch(`${baseURL}/api/test/n/${id}/settings?floor=${floor}`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  await response.text();
}

/** Stores a layout 1 note as an earlier release did, its floor held at 1 until a test raises it. */
export async function storeLayout1Note(
  baseURL: string,
  id: string,
  name: keyof typeof LAYOUT1_NOTES,
) {
  await setFloor(baseURL, id, 1);
  await writeRawNote(baseURL, id, (doc) => Y.applyUpdate(doc, layout1Note(name)));
}

/** A person: their name and colour, kept in their browser before the page loads. */
export async function asPerson(context: BrowserContext, name: string, color: number) {
  await context.addInitScript(
    ([n, c]) => {
      localStorage.setItem('jot:name', n);
      localStorage.setItem('jot:color', c);
    },
    [name, String(color)] as const,
  );
}

export function layoutsOf(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return Object.keys(doc.get('lexical-y').getAttrs())
    .filter((key) => key.startsWith('lexical-y:') || key === 'lexical-y-epoch')
    .sort();
}
