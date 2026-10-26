import { test as base, expect, type Page } from '@playwright/test';

/**
 * Sandboxed agent shells on macOS cannot run Chromium's multi-process mode
 * (mach port rendezvous is denied), and in single-process mode a browser
 * holds only one context. With JOT_E2E_SINGLE_PROCESS set, each test gets a
 * browser of its own. CI and normal machines use Playwright's defaults.
 */
export const test = process.env.JOT_E2E_SINGLE_PROCESS
  ? base.extend({
      context: async ({ playwright, contextOptions }, use) => {
        const browser = await playwright.chromium.launch({ args: ['--single-process'] });
        const context = await browser.newContext(contextOptions);
        await use(context);
        await browser.close();
      },
    })
  : base;

export { expect };

/** A fresh, valid note id, so tests never share a note. */
export function freshNoteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString('base64url');
}

export async function openNote(page: Page, id: string): Promise<void> {
  await page.goto(`/n/${id}`);
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
}

export function editor(page: Page) {
  return page.getByTestId('editor');
}
