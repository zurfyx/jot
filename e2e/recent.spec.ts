import type { BrowserContext, Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';

/**
 * Recently opened notes (D30): a list in this browser's localStorage that the
 * landing page shows right below the hero. Nothing reaches the server.
 */

const DAY = 86_400_000;

interface Seed {
  id: string;
  title: string;
  excerpt?: string;
  /** How long ago it was opened, in ms. */
  ago: number;
  example?: boolean;
}

/** Writes the list before any page script runs, relative to the page's clock. */
async function seed(context: BrowserContext, entries: Seed[]) {
  await context.addInitScript((list: Seed[]) => {
    // Once per browser context: a second tab must not seed over the first's changes.
    if (localStorage.getItem('e2e:seeded') !== null) {
      return;
    }
    localStorage.setItem('e2e:seeded', '1');
    const now = Date.now();
    localStorage.setItem(
      'jot:recent',
      JSON.stringify({
        entries: list.map(({ id, title, excerpt = '', ago, example }) => ({
          id,
          title,
          excerpt,
          openedAt: now - ago,
          ...(example ? { example: true } : {}),
        })),
        removed: {},
        clearedAt: 0,
      }),
    );
  }, entries);
}

function sample(count: number): Seed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: freshNoteId(),
    title: `Note ${index + 1}`,
    excerpt: `The text of note ${index + 1}.`,
    ago: (index + 1) * 60_000,
  }));
}

function section(page: Page) {
  return page.getByTestId('recent-notes');
}

function rows(page: Page) {
  return page.getByTestId('recent-note');
}

async function stored(page: Page): Promise<{ id: string; title: string }[]> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('jot:recent') ?? '{"entries":[]}').entries,
  );
}

function heroStart(page: Page) {
  return page
    .getByRole('region', { name: 'Just start typing.' })
    .getByRole('button', { name: /^Start a new note/ });
}

async function typeNote(page: Page, title: string, rest: string) {
  await editor(page).click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.keyboard.type(rest);
}

test('with no recent notes the section takes no space', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(section(page)).toBeHidden();
  await expect(page.getByText('Your recent notes')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-recent'))).toBe(
    false,
  );
});

test('a note you open shows on the landing page with its first line', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  // Listed from the moment it opens, before it has a first line.
  expect((await stored(page)).map((entry) => [entry.id, entry.title])).toEqual([
    [id, 'Untitled note'],
  ]);
  await typeNote(page, 'Lisbon trip', 'Flights on the 14th.');
  // Back to the landing page in the same tab: leaving writes the latest title.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(section(page).getByRole('heading', { name: 'Your recent notes' })).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Lisbon trip');
  await expect(rows(page).first()).toContainText('Flights on the 14th.');
  await expect(rows(page).first()).toContainText('Just now');
  await expect(rows(page).first().getByRole('link')).toHaveAttribute('href', `/n/${id}`);
});

test('a reload keeps the title typed last, written when the page hides', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await typeNote(page, 'Standup', 'Ana: eviction tests.');
  await page.goto('/');
  await expect(rows(page).first()).toContainText('Standup');
  await expect(rows(page).first()).toContainText('Ana: eviction tests.');
});

test('the example is labelled', async ({ page }) => {
  await page.goto('/new?example');
  await expect(page.getByTestId('example-banner')).toBeVisible({ timeout: 15_000 });
  await expect(editor(page)).toContainText('Team offsite', { timeout: 15_000 });
  await page.goto('/');
  await expect(rows(page).first()).toContainText('Team offsite, May 14');
  await expect(rows(page).first()).toContainText('Example · Just now');
});

test('clicking a note opens it, growing from its row', async ({ page, context }) => {
  const [first] = sample(1);
  await seed(context, [first!]);
  await openNote(page, first!.id);
  await typeNote(page, 'Opened from the list', '');
  await page.goto('/');
  await rows(page).first().getByRole('link').click();
  await expect(page).toHaveURL(`/n/${first!.id}`);
  await expect(editor(page)).toContainText('Opened from the list', { timeout: 15_000 });
});

test('one note can be removed, and the section goes with the last', async ({ page, context }) => {
  const notes = sample(2);
  await seed(context, notes);
  await page.goto('/');
  await expect(rows(page)).toHaveCount(2);
  const first = rows(page).first();
  const remove = first.getByRole('button', { name: 'Remove Note 1 from recent notes' });
  await expect(remove).toHaveCSS('opacity', '0');
  await first.hover();
  await expect(remove).toHaveCSS('opacity', '1');
  await remove.click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Note 2');
  expect((await stored(page)).map((entry) => entry.title)).toEqual(['Note 2']);
  // The focus moves to the note that took its place.
  await expect(rows(page).first().getByRole('link')).toBeFocused();
  await rows(page).first().hover();
  await rows(page)
    .first()
    .getByRole('button', { name: /^Remove/ })
    .click();
  await expect(section(page)).toBeHidden();
  // With none left, to the hero's primary action.
  await expect(heroStart(page)).toBeFocused();
});

test('Clear all asks first; Cancel and Escape keep the list', async ({ page, context }) => {
  await seed(context, sample(3));
  await page.goto('/');
  const clearAll = section(page).getByRole('button', { name: 'Clear all' });
  const confirm = section(page).getByRole('button', { name: 'Clear', exact: true });
  await clearAll.click();
  await expect(section(page)).toContainText('Clear all 3 recent notes?');
  // The question takes the focus.
  await expect(confirm).toBeFocused();
  await section(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(clearAll).toBeFocused();
  await clearAll.click();
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(clearAll).toBeFocused();
  await expect(rows(page)).toHaveCount(3);
  await clearAll.click();
  await confirm.click();
  await expect(section(page)).toBeHidden();
  await expect(heroStart(page)).toBeFocused();
  expect(await stored(page)).toEqual([]);
});

test('six show, then Show all', async ({ page, context }) => {
  await seed(context, sample(8));
  await page.goto('/');
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).first()).toContainText('Note 1');
  await section(page).getByRole('button', { name: 'Show all 8' }).click();
  await expect(rows(page)).toHaveCount(8);
  // The focus goes to the first note Show all revealed.
  await expect(rows(page).nth(6).getByRole('link')).toBeFocused();
  await expect(rows(page).nth(6)).toContainText('Note 7');
  await expect(section(page).getByRole('button', { name: /^Show all/ })).toHaveCount(0);
  // The section grows to hold them; nothing overlaps the next one.
  const list = await section(page).boundingBox();
  const last = await rows(page).last().boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(list!.y + list!.height + 1);
});

test('notes not opened for 90 days are gone (the relay deleted them)', async ({
  page,
  context,
}) => {
  const [fresh, old] = sample(2);
  await seed(context, [fresh!, { ...old!, title: 'Old', ago: 91 * DAY }]);
  await page.goto('/');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(fresh!.title);
});

test('the keyboard reaches every note and its remove button', async ({ page, context }) => {
  await seed(context, sample(3));
  await page.goto('/');
  const firstLink = rows(page).nth(0).getByRole('link');
  await firstLink.focus();
  // Focus inside a row shows its remove button, as hover does.
  const remove = rows(page)
    .nth(0)
    .getByRole('button', { name: /^Remove/ });
  await expect(remove).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(2);
  // The focus goes to the note that took its place.
  await expect(rows(page).nth(0).getByRole('link')).toBeFocused();
  await expect(rows(page).nth(0)).toContainText('Note 2');
  // Removing the last row moves the focus to the one before it.
  await rows(page).nth(1).getByRole('link').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).nth(0).getByRole('link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/);
});

test('on a touch screen the remove button is always there', async ({ newContext }) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await seed(context, sample(2));
  const page = await context.newPage();
  await page.goto('/');
  const remove = rows(page)
    .first()
    .getByRole('button', { name: /^Remove/ });
  await expect(remove).toHaveCSS('opacity', '1');
  // At least 32px of taps around a 26px button.
  await remove.scrollIntoViewIfNeeded();
  const box = (await remove.boundingBox())!;
  expect(box.width).toBe(26);
  const hits = await page.evaluate(
    ({ x, y, width, height }) =>
      [
        [x - 3, y + height / 2],
        [x + width + 3, y + height / 2],
        [x + width / 2, y - 3],
        [x + width / 2, y + height + 3],
      ].map(([px, py]) =>
        document.elementFromPoint(px!, py!)?.closest('button')?.getAttribute('aria-label'),
      ),
    box,
  );
  expect(hits).toEqual(Array(4).fill('Remove Note 1 from recent notes'));
  await remove.tap();
  await expect(rows(page)).toHaveCount(1);
});

test('another tab sees a note you open, without a reload', async ({ context }) => {
  const landing = await context.newPage();
  await landing.goto('/');
  await expect(section(landing)).toBeHidden();
  const note = await context.newPage();
  await openNote(note, freshNoteId());
  await expect(rows(landing)).toHaveCount(1);
  await expect(rows(landing).first()).toContainText('Untitled note');
  await typeNote(note, 'Typed in the other tab', '');
  await expect(rows(landing).first()).toContainText('Typed in the other tab', {
    timeout: 10_000,
  });
  // Clearing in one tab clears the other.
  await section(landing).getByRole('button', { name: 'Clear all' }).click();
  await section(landing).getByRole('button', { name: 'Clear', exact: true }).click();
  await note.goto('/');
  await expect(section(note)).toBeHidden();
});

test('the rows are reserved before the app runs, so a prerendered slot keeps its size', async ({
  page,
  context,
}) => {
  await seed(context, sample(3));
  // Hold the app's script: only index.html's inline script has run.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/src\/client\/main\.tsx/, async (route) => {
    await held;
    await route.continue();
  });
  void page.goto('/');
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-recent'));
  const hint = await page.evaluate(() => {
    const style = document.documentElement.style;
    return [
      style.getPropertyValue('--jot-recent-rows'),
      style.getPropertyValue('--jot-recent-rows-wide'),
    ];
  });
  expect(hint).toEqual(['3', '2']);
  release();
  await expect(rows(page)).toHaveCount(3);
  // Two columns: the slot holds two rows of 60px, with its heading and its foot.
  const filled = (await section(page).boundingBox())!.height;
  expect(filled).toBe(8 + 32 + 2 * 60 + 44);
  // Empty, as a prerender draws it, the slot is the same size from <html>'s hint alone.
  const empty = await page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>('[data-testid="recent-notes"]')!;
    const copy = slot.cloneNode(false) as HTMLElement;
    copy.removeAttribute('style');
    slot.after(copy);
    const height = copy.getBoundingClientRect().height;
    copy.remove();
    return height;
  });
  expect(empty).toBe(filled);
});

test('where storage is denied, the landing page and notes still work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(section(page)).toBeHidden();
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await typeNote(page, 'Still works', '');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(section(page)).toBeHidden();
});

test('the notes are a list to assistive technology', async ({ page, context }) => {
  await seed(context, sample(3));
  await page.goto('/');
  const list = section(page).getByRole('list');
  await expect(list).toHaveAttribute('role', 'list');
  await expect(list.getByRole('listitem')).toHaveCount(3);
});

test('the times move on while the page stays open', async ({ page }) => {
  await page.clock.install();
  await openNote(page, freshNoteId());
  await page.goto('/');
  await expect(rows(page).first()).toContainText('Just now');
  await page.clock.fastForward(125_000);
  await expect(rows(page).first()).toContainText('2 min ago');
  // 90 days on, the note is pruned at the next refresh, without any write.
  await page.clock.setSystemTime(Date.now() + 91 * DAY);
  await page.clock.fastForward(61_000);
  await expect(section(page)).toBeHidden();
});

test('a Clear in another tab sticks while a note stays open and is edited', async ({ context }) => {
  await seed(context, sample(2));
  const page = await context.newPage();
  await page.goto('/');
  await expect(rows(page)).toHaveCount(2);
  // Open a third note from the landing page, in the same tab (history keeps the landing page).
  await heroStart(page).click();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await typeNote(page, 'Typed before the Clear', '');
  // Another tab clears the list.
  const other = await context.newPage();
  await other.goto('/');
  await expect(rows(other)).toHaveCount(3);
  await section(other).getByRole('button', { name: 'Clear all' }).click();
  await section(other).getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(section(other)).toBeHidden();
  // Typing on, then leaving, writes its title but can't bring the note back.
  await page.bringToFront();
  await page.keyboard.type(' and after it');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The slot reserved before the Clear is gone: no empty gap is left.
  await expect(section(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-recent'))).toBe(
    false,
  );
  expect(await stored(page)).toEqual([]);
});
