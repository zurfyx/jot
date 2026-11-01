import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';

import {
  CARD_HEIGHT,
  CARD_KEYWORD,
  CARD_WIDTH,
  cardFile,
  cardHash,
  cardHtml,
  type CardHead,
  withTextChunk,
} from './og.ts';

/**
 * Draws every public page's link-preview card into public/og/ (D31):
 * `pnpm og-images`, then commit the PNGs. Run it after changing a page's
 * title or description (src/client/heads.ts, site.ts), or the card itself in
 * scripts/og.ts; scripts/og.test.ts fails until the cards match.
 */

const ROOT = join(import.meta.dirname, '..');

// src/client/heads.ts, loaded the way the app loads it.
const vite = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});
const { PAGE_HEADS } = (await vite.ssrLoadModule('/src/client/heads.ts')) as {
  PAGE_HEADS: readonly (CardHead & { image: string })[];
};
await vite.close();

const font = await readFile(
  join(ROOT, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'),
);
const fontUrl = `data:font/woff2;base64,${font.toString('base64')}`;

// Sandboxed macOS shells can only run Chromium in one process (AGENTS.md).
const browser = await chromium.launch(
  process.env.JOT_E2E_SINGLE_PROCESS ? { args: ['--single-process'] } : {},
);
const page = await browser.newPage({
  viewport: { width: CARD_WIDTH, height: CARD_HEIGHT },
  deviceScaleFactor: 1,
});
for (const head of PAGE_HEADS) {
  await page.setContent(cardHtml(head).replace('FONT_URL', fontUrl));
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png' });
  const file = cardFile(head.image);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, withTextChunk(png, CARD_KEYWORD, cardHash(head)));
  console.log(`og: ${head.image}`);
}
await browser.close();
