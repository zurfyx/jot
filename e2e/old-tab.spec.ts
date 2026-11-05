import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import * as Y from '@y/y';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { layout1Note } from '../src/shared/testing/layout1';
import { readRawNote, writeRawNote } from './raw-client';

/**
 * A real jot from before the fence (D34) against this release's Worker: its
 * built pages are served from JOT_E2E_OLD_DIST (the `dist/client` of such a
 * build), its socket reaches this server. Local only: CI has no old build.
 */
const OLD_DIST = process.env.JOT_E2E_OLD_DIST;

test.skip(
  !OLD_DIST,
  'needs JOT_E2E_OLD_DIST: the dist/client of a jot build from before the fence',
);

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/**
 * A browser for the older tab. A page whose document a route fulfilled has no
 * address space, so Chromium's local network access checks block its socket
 * to this (loopback) server; this browser runs without them.
 */
async function olderBrowser(playwright: PlaywrightWorkerArgs['playwright']) {
  const args = ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'];
  if (process.env.JOT_E2E_SINGLE_PROCESS) {
    args.push('--single-process');
  }
  return playwright.chromium.launch({ args });
}

/** Serves the older build's note page and assets to `page`; the API stays this server's. */
async function asOlderJot(page: Page) {
  await page.route(
    (url) => /^\/(n\/[\w-]{22}$|assets\/)/.test(url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = path.startsWith('/n/')
        ? join(OLD_DIST!, 'n', 'shell.html')
        : join(OLD_DIST!, path);
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

/** Moves the note on: a new incarnation, every socket closed. `inherited` marks it as from before the fence. */
async function replaceIncarnation(baseURL: string, id: string, inherited = false) {
  const response = await fetch(
    `${baseURL}/api/test/n/${id}/replace-incarnation${inherited ? '?inherited=1' : ''}`,
    { method: 'POST' },
  );
  expect(response.status).toBe(200);
  await response.text();
}

function noteText(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return JSON.stringify(doc.get('lexical-y').toJSON());
}

async function workOffline(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');
}

test('an older tab with offline edits, on a note that moved on, keeps its text, turns read only, and its edits wait under Offline edits', async ({
  context,
  playwright,
  baseURL,
}) => {
  const id = freshNoteId();
  const today = await context.newPage();
  // The note as it was before the fence shipped (layout 1, as an earlier jot
  // stored it): the older tab edits it as always.
  await writeRawNote(baseURL!, id, (doc) => Y.applyUpdate(doc, layout1Note('shared')));
  await replaceIncarnation(baseURL!, id, true);

  const browser = await olderBrowser(playwright);
  const older = await (await browser.newContext({ baseURL })).newPage();
  await asOlderJot(older);
  await openNote(older, id);
  await expect(editor(older)).toContainText('Shared start');
  await workOffline(older);
  await editor(older).click();
  await older.keyboard.press('ControlOrMeta+End');
  await older.keyboard.press('Enter');
  await older.keyboard.type('Typed in the older tab');

  // The note moves on while the older tab is offline.
  await replaceIncarnation(baseURL!, id);
  await older.getByRole('button', { name: 'Reconnect' }).click();
  await expect(older.getByText('This note was written by a newer version of jot')).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor(older)).toHaveAttribute('contenteditable', 'false');
  // Its own text stays on its screen: nothing of the note reached it.
  await expect(editor(older)).toContainText('Typed in the older tab');
  await expect(editor(older)).toContainText('Shared start');

  // Never in the note; under Offline edits. This release reads layout 3 and
  // up and migrates nothing: the note stays at layout 1, which its pages (and
  // the raw client, which presents this release's handshake) are refused
  // until R+1 migrates it.
  await today.goto(`/n/${id}`);
  await expect(today.getByTestId('status-pill')).toContainText('Reload to edit', {
    timeout: 15_000,
  });
  await expect(editor(today)).not.toContainText('Typed in the older tab');
  await today.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await today.getByTestId('recovery-item').click();
  await today.getByTestId('recovery-row').first().getByRole('button', { name: 'View' }).click();
  await expect(today.getByTestId('recovery-text')).toContainText('Typed in the older tab');
  await browser.close();
});

test('an older tab on a new note seeds nothing and opens read only', async ({
  playwright,
  baseURL,
}) => {
  const id = freshNoteId();
  const browser = await olderBrowser(playwright);
  const page = await (await browser.newContext({ baseURL })).newPage();
  await asOlderJot(page);
  await page.goto(`/n/${id}`);
  await expect(page.getByText('This note was written by a newer version of jot')).toBeVisible({
    timeout: 15_000,
  });
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  expect(noteText(await readRawNote(baseURL!, id))).not.toContain('paragraph');
  await browser.close();
});
