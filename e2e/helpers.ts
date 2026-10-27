import {
  test as base,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test';

const SINGLE_PROCESS = !!process.env.JOT_E2E_SINGLE_PROCESS;

/**
 * Sandboxed agent shells on macOS cannot run Chromium's multi-process mode
 * (mach port rendezvous is denied), and in single-process mode a browser
 * holds only one context. With JOT_E2E_SINGLE_PROCESS set, each test gets a
 * browser of its own. CI and normal machines use Playwright's defaults.
 *
 * `otherContext` is a second browser context: another person, with storage
 * of its own (pages of one context share localStorage, so they are one
 * person).
 */
type ContextOptions = Parameters<Browser['newContext']>[0];

interface Fixtures {
  otherContext: BrowserContext;
  /**
   * A fresh browser context with these options (and the project's), closed
   * after the test: a browser of its own in single-process mode.
   */
  newContext: (options?: ContextOptions) => Promise<BrowserContext>;
}

export const test = SINGLE_PROCESS
  ? base.extend<Fixtures>({
      context: async ({ playwright, contextOptions }, use) => {
        const browser = await playwright.chromium.launch({ args: ['--single-process'] });
        const context = await browser.newContext(contextOptions);
        await use(context);
        await browser.close();
      },
      otherContext: async ({ playwright, contextOptions }, use) => {
        const browser = await playwright.chromium.launch({ args: ['--single-process'] });
        const context = await browser.newContext(contextOptions);
        await use(context);
        await browser.close();
      },
      newContext: async ({ playwright, contextOptions }, use) => {
        const browsers: Awaited<ReturnType<typeof playwright.chromium.launch>>[] = [];
        await use(async (options) => {
          const browser = await playwright.chromium.launch({ args: ['--single-process'] });
          browsers.push(browser);
          return browser.newContext({ ...contextOptions, ...options });
        });
        await Promise.all(browsers.map((browser) => browser.close()));
      },
    })
  : base.extend<Fixtures>({
      otherContext: async ({ browser, contextOptions }, use) => {
        const context = await browser.newContext(contextOptions);
        await use(context);
        await context.close();
      },
      newContext: async ({ browser, contextOptions }, use) => {
        const contexts: BrowserContext[] = [];
        await use(async (options) => {
          const context = await browser.newContext({ ...contextOptions, ...options });
          contexts.push(context);
          return context;
        });
        await Promise.all(contexts.map((context) => context.close()));
      },
    });

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
