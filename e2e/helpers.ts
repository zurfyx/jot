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

/**
 * The landing page, the docs and the 404 page arrive prerendered (D31): they
 * show before React hydrates them, and a click on a button before then does
 * nothing (a link still navigates, the browser's way). So a `goto` or
 * `reload` that waits for the page to load (the default) waits for the app
 * too: <html> gets `data-hydrated` once the page's own content has hydrated
 * (src/client/hydrated.ts). A response that is no app page (a 400) has no
 * root to wait for. A test that holds the app's
 * script back, or turns scripts off, asks for `commit` or `domcontentloaded`.
 */
function waitForApp(page: Page): void {
  const patched = page as Page & { jotWaits?: true };
  if (patched.jotWaits) {
    return;
  }
  patched.jotWaits = true;
  const ready = () =>
    page.waitForFunction(
      () =>
        document.getElementById('root') === null || 'hydrated' in document.documentElement.dataset,
      undefined,
      { timeout: 15_000 },
    );
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const response = await goto(url, options);
    if ((options?.waitUntil ?? 'load') === 'load') {
      await ready();
    }
    return response;
  };
  const reload = page.reload.bind(page);
  page.reload = async (options) => {
    const response = await reload(options);
    if ((options?.waitUntil ?? 'load') === 'load') {
      await ready();
    }
    return response;
  };
}

/** Every page of `context`, open now or later, waits for the app (above). */
function waitingForApp(context: BrowserContext): BrowserContext {
  context.pages().forEach(waitForApp);
  context.on('page', waitForApp);
  return context;
}

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
        const context = waitingForApp(await browser.newContext(contextOptions));
        await use(context);
        await browser.close();
      },
      page: async ({ page }, use) => {
        waitForApp(page);
        await use(page);
      },
      otherContext: async ({ playwright, contextOptions }, use) => {
        const browser = await playwright.chromium.launch({ args: ['--single-process'] });
        const context = waitingForApp(await browser.newContext(contextOptions));
        await use(context);
        await browser.close();
      },
      newContext: async ({ playwright, contextOptions }, use) => {
        const browsers: Awaited<ReturnType<typeof playwright.chromium.launch>>[] = [];
        await use(async (options) => {
          const browser = await playwright.chromium.launch({ args: ['--single-process'] });
          browsers.push(browser);
          return waitingForApp(await browser.newContext({ ...contextOptions, ...options }));
        });
        await Promise.all(browsers.map((browser) => browser.close()));
      },
    })
  : base.extend<Fixtures>({
      context: async ({ context }, use) => {
        await use(waitingForApp(context));
      },
      page: async ({ page }, use) => {
        waitForApp(page);
        await use(page);
      },
      otherContext: async ({ browser, contextOptions }, use) => {
        const context = waitingForApp(await browser.newContext(contextOptions));
        await use(context);
        await context.close();
      },
      newContext: async ({ browser, contextOptions }, use) => {
        const contexts: BrowserContext[] = [];
        await use(async (options) => {
          const context = waitingForApp(
            await browser.newContext({ ...contextOptions, ...options }),
          );
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
