import { MIN_LAYOUT } from '@lexical/y';
import { type Browser, type BrowserContext, type Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { readRawNote } from './raw-client';
import {
  asPerson,
  layoutsOf,
  otherBuildBrowser,
  serveBuild,
  setFloor,
  storeLayout1Note,
  TARGET,
} from './release';

/**
 * Release R+1 (D34) end to end: a layout 1 note, a tab offline with edits,
 * the note's floor raised, its first open migrates it in place (to layout 2
 * with the 1to2 step, or to 3 once the library's floor is 3), and the offline
 * tab hands its edits off: they wait under Offline edits (replay at the note
 * is deferred until @lexical/y ships it).
 *
 * The offline tab is this build, or, with JOT_E2E_R_DIST (the dist/client of
 * a release R build), an R page: the realistic case at layout 3, where no
 * R+1 page reads layout 1. After its handoff an R page is refused the newer
 * layout and reloads; the test then serves it this build, as a deploy does.
 */
const R_DIST = process.env.JOT_E2E_R_DIST || undefined;

test.skip(
  MIN_LAYOUT > 2 && !R_DIST,
  'at layout 3 the offline tab must be an R page: set JOT_E2E_R_DIST to the dist/client of an R build',
);

interface OfflineTab {
  page: Page;
  /** Whether the page runs this build (an R page that stayed R does not). */
  thisBuild(): boolean;
  /** After its handoff: an R page refused a layout it cannot read shows the upgrade notice; then it loads this build. */
  upgrade(): Promise<void>;
  close(): Promise<void>;
}

async function offlineTab(
  context: BrowserContext,
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
  person: [string, number] | null,
): Promise<OfflineTab> {
  if (R_DIST === undefined) {
    const page = await context.newPage();
    return { page, thisBuild: () => true, upgrade: async () => {}, close: async () => {} };
  }
  const browser: Browser = await otherBuildBrowser(playwright);
  const ctx = await browser.newContext({ baseURL });
  if (person !== null) {
    await asPerson(ctx, ...person);
  }
  const page = await ctx.newPage();
  let r = true;
  await serveBuild(page, R_DIST, () => r);
  return {
    page,
    thisBuild: () => !r,
    upgrade: async () => {
      if (TARGET <= 2) {
        // An R page reads layout 2: it keeps editing the migrated note.
        return;
      }
      await expect(page.getByText('This note was upgraded')).toBeVisible({ timeout: 20_000 });
      r = false;
      await page.reload();
    },
    close: () => browser.close(),
  };
}

async function workOffline(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');
}

async function appendLine(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
}

/** Raises the note's floor and opens it in this build: that first open migrates it. */
async function migrate(page: Page, baseURL: string, id: string) {
  await setFloor(baseURL, id, TARGET);
  await page.addInitScript(
    (value) => localStorage.setItem('jot:test-floor', String(value)),
    TARGET,
  );
  await openNote(page, id);
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect
    .poll(async () => layoutsOf(await readRawNote(baseURL, id)))
    .toContain(`lexical-y:${TARGET}`);
}

test('a note migrates on its first open; a tab offline across it keeps its edits under Offline edits', async ({
  context,
  playwright,
  baseURL,
}) => {
  const id = freshNoteId();
  await storeLayout1Note(baseURL!, id, 'shared');
  const b = await offlineTab(context, playwright, baseURL!, null);
  await openNote(b.page, id);
  await expect(editor(b.page)).toContainText('Shared start');
  await workOffline(b.page);
  // Offline: a word of the note made bold (its base value is known: plain), and a new line.
  await editor(b.page)
    .getByText('Shared start')
    .dblclick({ position: { x: 4, y: 8 } });
  await b.page.keyboard.press('ControlOrMeta+B');
  await expect(editor(b.page).locator('.jot-bold')).toHaveText('Shared');
  await appendLine(b.page, 'Written offline');
  await expect(b.page.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);

  const a = await context.newPage();
  await migrate(a, baseURL!, id);
  await expect(editor(a)).toContainText('Shared start');
  expect(layoutsOf(await readRawNote(baseURL!, id))).toEqual(
    ['lexical-y-epoch', ...Array.from({ length: TARGET }, (_, i) => `lexical-y:${i + 1}`)].sort(),
  );
  await expect(editor(a)).not.toContainText('Written offline');

  await b.page.getByRole('button', { name: 'Reconnect' }).click();
  await b.upgrade();
  await expect(b.page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  // The offline edits did not go into the note: they wait under Offline edits.
  await expect(editor(a)).not.toContainText('Written offline');
  await expect(editor(b.page)).not.toContainText('Written offline');
  const banner = b.page.getByTestId('recovery-banner');
  await expect(banner).toContainText('Edits you made offline');
  await banner.getByRole('button', { name: 'View' }).click();
  await expect(b.page.getByTestId('recovery-text')).toContainText('Written offline');
  await expect(b.page.getByTestId('recovery-text').locator('.jot-bold')).toHaveText('Shared');
  // Both keep editing the migrated note.
  await appendLine(a, 'After the migration');
  await expect(editor(b.page)).toContainText('After the migration');
  await b.close();
});
