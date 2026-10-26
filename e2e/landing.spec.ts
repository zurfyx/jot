import type { Page } from '@playwright/test';

import { expect, freshNoteId, test } from './helpers';

/**
 * The landing page's start actions open the local draft at `/new` (D18); the
 * example ones a new shared example note, which moves to `/n/<id>` (D20).
 */
async function expectNotePage(page: Page, kind: 'draft' | 'example' = 'draft') {
  await expect(page.getByTestId('editor')).toBeVisible({ timeout: 15_000 });
  if (kind === 'draft') {
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByTestId('status-pill')).toHaveText('Only on this device');
  } else {
    await expect(page).toHaveURL(/\/n\/[\w-]{22}$/, { timeout: 15_000 });
    await expect(page.getByTestId('example-banner')).toBeVisible();
  }
  // The landing page's styles stay loaded; the editor's own must still win.
  await expect(page.locator('.note-avatar').first()).not.toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
}

test('the hero has its title, buttons and links', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('jot · Just start typing');
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
  await expect(page.getByText('Live · Lexical + Yjs 14 playground')).toBeVisible();
  const start = page.getByRole('button', { name: /^Start a new note/ });
  await expect(start).toHaveCount(2);
  await expect(start.first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'See the example' })).toBeVisible();
  await expect(page.getByLabel('Note link or code')).toHaveAttribute(
    'placeholder',
    'Or paste a note link to join it.',
  );
  const nav = page.getByRole('navigation', { name: 'Site' });
  await expect(nav.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
  await expect(nav.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/zurfyx/jot',
  );
  await expect(page.getByRole('link', { name: 'Open a new note' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the example' })).toBeAttached();
});

test('the sections below the hero', async ({ page }) => {
  await page.goto('/');
  for (const name of [
    'Start a note. Share it. Type together.',
    'Lexical with Yjs 14, up close.',
    'Read the code that matters.',
    'Try it, then see how it works.',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  for (const question of [
    'Is my note private?',
    'How long do notes last?',
    'What is Yjs 14?',
    'Can I run my own?',
  ]) {
    await expect(page.getByText(question)).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Quick start in about 20 lines' })).toHaveAttribute(
    'href',
    /^\/docs\//,
  );
  await expect(page.getByText('© 2026 Gerard Rovira · MIT License')).toBeVisible();
  // No em dashes anywhere on the page (house rule).
  expect(await page.locator('body').innerText()).not.toContain('\u2014');
});

test('Start a new note opens a note', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  await expectNotePage(page);
});

test('⌘↵ (Ctrl+Enter) starts a new note from anywhere on the page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Note link or code').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expectNotePage(page);
});

test('any printable key starts a new note, except inside the paste field', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Note link or code').pressSequentially('abc');
  await expect(page).toHaveURL('/');
  await page.getByLabel('Note link or code').blur();
  await page.keyboard.press('Shift');
  // Space scrolls the page instead.
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.keyboard.press('Shift+ ');
  await expect(page).toHaveURL('/');
  await page.keyboard.press('k');
  await expectNotePage(page);
});

/** Records every client-side navigation, so a test can tell `/new` from `/new?example`. */
async function recordPushes(page: Page) {
  await page.addInitScript(() => {
    const pushes: string[] = [];
    (window as unknown as { __pushes: string[] }).__pushes = pushes;
    const push = history.pushState.bind(history);
    history.pushState = (state, unused, url) => {
      pushes.push(String(url));
      push(state, unused, url);
    };
  });
}

function pushes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __pushes: string[] }).__pushes);
}

/**
 * A point inside `testId`'s card that is on top (the fan overlaps its cards),
 * relative to the card's box, for `click({ position, force: true })`.
 */
async function visiblePoint(page: Page, testId: string) {
  const point = await page.evaluate((id) => {
    const card = document.querySelector(`[data-testid="${id}"]`)!;
    const box = card.getBoundingClientRect();
    for (let y = box.top + 30; y < box.bottom; y += 12) {
      for (let x = box.right - 20; x > box.left; x -= 12) {
        if (document.elementFromPoint(x, y)?.closest(`[data-testid="${id}"]`) === card) {
          return { x: x - box.left, y: y - box.top };
        }
      }
    }
    return null;
  }, testId);
  expect(point).not.toBeNull();
  return point!;
}

for (const { testId, name, path, kind } of [
  {
    testId: 'new-note-card',
    name: 'the New note card starts a note',
    path: '/new',
    kind: 'draft' as const,
  },
  {
    testId: 'example-card',
    name: 'the example card opens the example',
    path: '/new?example',
    kind: 'example' as const,
  },
]) {
  test(name, async ({ page }) => {
    await recordPushes(page);
    await page.goto('/');
    const card = page.getByTestId(testId);
    await card.hover({ position: await visiblePoint(page, testId), force: true });
    await page.waitForTimeout(900); // the card lifts
    await expect(card.locator('.card-open')).toHaveCSS('opacity', '1');
    await card.click({ position: await visiblePoint(page, testId), force: true });
    await expectNotePage(page, kind);
    expect(await pushes(page)).toEqual([path]);
  });
}

test('See the example opens the example', async ({ page }) => {
  await recordPushes(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'See the example' }).click();
  await expectNotePage(page, 'example');
  expect(await pushes(page)).toEqual(['/new?example']);
});

test('the footer links open a note in place, or a tab with a modifier', async ({ page }) => {
  await recordPushes(page);
  await page.goto('/');
  const footer = page.getByRole('navigation', { name: 'Product' });
  await expect(footer.getByRole('link', { name: 'Example' })).toHaveAttribute(
    'href',
    '/new?example',
  );
  await footer.getByRole('link', { name: 'New note' }).click();
  await expectNotePage(page);
  expect(await pushes(page)).toEqual(['/new']);
});

test('the feature tabs advance every 3 s and stop when one is chosen', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Features' });
  await tabs.scrollIntoViewIfNeeded();
  const tab = (name: string) => tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
  const state = page.getByTestId('engine-state');

  await expect(tab('Live cursors')).toHaveAttribute('aria-selected', 'true');
  await expect(state).toHaveText('3 here');
  await expect(tab('Blame')).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  await expect(state).toContainText('Blame · You 46%');
  await expect(tab('Offline, then merge')).toHaveAttribute('aria-selected', 'true', {
    timeout: 5000,
  });

  await tab('Live cursors').click();
  await expect(tab('Live cursors')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(3600);
  await expect(tab('Live cursors')).toHaveAttribute('aria-selected', 'true');
  await expect(state).toHaveText('3 here');

  // The arrow keys move between tabs too.
  await page.keyboard.press('ArrowDown');
  await expect(tab('Blame')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Blame')).toBeFocused();
});

for (const width of [1440, 390]) {
  test(`the Blame stage lays out as name, bar, text at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const tabs = page.getByRole('tablist', { name: 'Features' });
    await tabs.scrollIntoViewIfNeeded();
    await tabs.getByRole('tab', { name: /^Blame/ }).click();

    const rows = page.getByTestId('stage-blame-row');
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('stage-blame-name')).toHaveText(['You', 'jot AI', 'Ana']);

    // The paragraph flows: one or two lines, not a word per line.
    const paragraph = rows.first().locator('p');
    const lineHeight = await paragraph.evaluate((el) =>
      parseFloat(getComputedStyle(el).lineHeight),
    );
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const rect = await locator.boundingBox();
      if (!rect) throw new Error('not rendered');
      return rect;
    };
    expect((await box(paragraph)).height).toBeLessThanOrEqual(lineHeight * 2 + 1);
    expect((await box(rows.nth(1).locator('li').first())).height).toBeLessThanOrEqual(
      lineHeight * 2 + 1,
    );

    const pill = await box(page.getByTestId('engine-state'));
    let previousBottom = pill.y + pill.height;
    for (let index = 0; index < 3; index++) {
      const row = await box(rows.nth(index));
      const name = await box(rows.nth(index).getByTestId('stage-blame-name'));
      const bar = await box(rows.nth(index).getByTestId('stage-blame-bar'));
      // Each name sits in its own row, below the one before and the pill, never on them.
      expect(name.y).toBeGreaterThanOrEqual(previousBottom);
      expect(name.y + name.height).toBeLessThanOrEqual(row.y + row.height + 1);
      previousBottom = name.y + name.height;
      // A narrow name column, then a thin bar as tall as the row, then the text.
      expect(name.width).toBeLessThanOrEqual(56);
      expect(name.x + name.width).toBeLessThanOrEqual(bar.x);
      expect(bar.width).toBeLessThanOrEqual(4);
      expect(bar.height).toBeGreaterThan(row.height - 2);
    }
  });
}

test('nothing moves under reduced motion; the final states show', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'Open a new note' }).hover();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  // The example card shows its finished text, and the story its last step.
  const example = page.getByTestId('example-card');
  await expect(example).toContainText('with demos');
  await expect(example).toContainText('Send the agenda');
  await expect(page.getByTestId('how-steps').locator('li.is-on')).toHaveCount(3);

  // The tabs don't advance on their own.
  const tabs = page.getByRole('tablist', { name: 'Features' });
  await page.waitForTimeout(3600);
  await expect(tabs.getByRole('tab', { name: /^Live cursors/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const before = await example.innerText();
  await page.waitForTimeout(500);
  expect(await example.innerText()).toBe(before);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('the landing page loads without the editor chunk', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      scripts.push(request.url());
    }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(scripts.some((url) => /NotePage|lexical|@y\/y|yjs/i.test(url))).toBe(false);
});

test('the paste field validates in place', async ({ page }) => {
  await page.goto('/');
  const field = page.getByLabel('Note link or code');
  const open = page.getByRole('button', { name: 'Open', exact: true });
  await expect(open).toBeDisabled();

  await field.fill('hello there');
  await expect(page.getByText("That isn't a note link or code.")).toBeVisible();
  await expect(open).toBeDisabled();

  const id = freshNoteId();
  await field.fill(`https://jot.rovira.sh/n/${id}`);
  await expect(page.getByText(`Opens note ${id.slice(0, 6)}…`)).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(`/n/${id}`);
});

test('a bare code opens its note', async ({ page }) => {
  await page.goto('/');
  const id = freshNoteId();
  await page.getByLabel('Note link or code').fill(id);
  await page.getByLabel('Note link or code').press('Enter');
  await expect(page).toHaveURL(`/n/${id}`);
});

test('a malformed note link is a 400', async ({ request }) => {
  const response = await request.get('/n/not-a-note');
  expect(response.status()).toBe(400);
});

test('there is no public note', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Just start typing.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'public note' })).toHaveCount(0);
  const response = await request.get('/n/public');
  expect(response.status()).toBe(400);
});

test('notes stay out of search engines and the landing page does not', async ({ request }) => {
  const note = await request.get(`/n/${freshNoteId()}`);
  expect(note.status()).toBe(200);
  expect(note.headers()['x-robots-tag']).toBe('noindex, nofollow');

  const landing = await request.get('/');
  expect(landing.headers()['x-robots-tag']).toBeUndefined();

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const lines = (await robots.text()).split('\n');
  expect(lines).toEqual(
    expect.arrayContaining(['User-agent: *', 'Disallow: /n/', 'Disallow: /api/']),
  );
});
