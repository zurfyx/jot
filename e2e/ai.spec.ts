import type { Page } from '@playwright/test';

import { modelLog, withFakeModel } from './fakes';
import { editor, expect, freshNoteId, openNote, test } from './helpers';

async function writeTwoLines(page: Page) {
  await editor(page).click();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Demos, lunch, hack session');
}

function askButton(page: Page) {
  return page.getByTestId('dock').getByTestId('ask-ai');
}

test('jot AI rewrites the current block as its own peer, attributed to it in blame', async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
  const page = await withFakeModel(context, { reply: '- Roadmap\n- Team lunch\n- Hacking' });
  await openNote(page, id);
  const other = await otherContext.newPage();
  await openNote(other, id);
  await writeTwoLines(page);
  await expect(editor(other)).toContainText('Demos, lunch, hack session');

  // Opening the field and typing sends nothing.
  await askButton(page).click();
  const panel = page.getByTestId('ask-panel');
  await expect(panel.getByTestId('ask-meta')).toHaveText(
    'Rewrites this block · Gemini Nano, on this device',
  );
  // The target is tinted while the field is open.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const highlight = CSS.highlights.get('jot-ai-target');
        return highlight ? [...highlight].map((range) => String(range)).join('') : null;
      }),
    )
    .toBe('Demos, lunch, hack session');
  await panel.getByRole('button', { name: 'Make it a list' }).click();
  await expect(panel.getByTestId('ask-input')).toHaveValue('Make it a list');
  expect(await modelLog(page)).toMatchObject({ create: 0, prompts: [] });

  await panel.getByTestId('ask-submit').click();
  await expect(editor(page).locator('li')).toHaveText(['Roadmap', 'Team lunch', 'Hacking']);
  await expect(panel).toHaveCount(0);
  const log = await modelLog(page);
  expect(log.create).toBe(1);
  expect(log.prompts).toHaveLength(1);
  expect(log.prompts[0]).toContain('Instruction: Make it a list');
  expect(log.prompts[0]).toContain('Demos, lunch, hack session');
  expect(log.prompts[0]).not.toContain('Plan');
  await expect(editor(page)).toContainText('Plan');
  await expect(page.evaluate(() => CSS.highlights.has('jot-ai-target'))).resolves.toBe(false);

  // jot AI is a peer: its violet caret shows here and in the other window,
  // which gets the edit through the relay.
  await expect(page.getByTestId('remote-caret').filter({ hasText: 'jot AI' })).toHaveCount(1);
  await expect(editor(other).locator('li')).toHaveText(['Roadmap', 'Team lunch', 'Hacking']);
  await expect(other.getByTestId('remote-caret').filter({ hasText: 'jot AI' })).toHaveCount(1);

  // Blame names jot AI for the list, asked by this person. (The binding keeps
  // characters a rewrite leaves as they were, so blame credits jot AI with
  // what it changed; this reply shares nothing with the line it replaced.)
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('blame-chip').click();
  await expect(
    page.getByTestId('blame-legend').getByTestId('blame-person').locator('.person-name'),
  ).toHaveText(['jot AI', 'You']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('blame-name')).toHaveText(['You', 'jot AI']);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...CSS.highlights.entries()]
          .filter(([name]) => name.startsWith('jot-blame-'))
          .map(([, highlight]) =>
            [...highlight]
              .map((range) => {
                // Blame paints StaticRanges; read each one through a live Range.
                const live = document.createRange();
                live.setStart(range.startContainer, range.startOffset);
                live.setEnd(range.endContainer, range.endOffset);
                return live.toString();
              })
              .join('|'),
          )
          .sort(),
      ),
    )
    .toEqual(['Plan', 'Roadmap|Team lunch|Hacking']);
  const box = await editor(page).getByText('Team lunch').boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
  await expect(page.getByTestId('blame-card')).toContainText('jot AI');
  await expect(page.getByTestId('blame-card')).toContainText('asked by You');
});

test("asking on someone else's note before typing still names the asker", async ({
  context,
  otherContext,
}) => {
  const id = freshNoteId();
  await context.addInitScript(() => localStorage.setItem('jot:name', 'Gerard'));
  const gerard = await context.newPage();
  await otherContext.addInitScript(() => localStorage.setItem('jot:name', 'Ana'));
  const ana = await withFakeModel(otherContext, { reply: 'Roadmap, team lunch, hacking' });
  await openNote(gerard, id);
  await writeTwoLines(gerard);
  await openNote(ana, id);
  await expect(editor(ana)).toContainText('Demos, lunch, hack session');

  // Ana only clicks into the line and asks: she has typed nothing.
  await editor(ana).getByText('Demos, lunch, hack session').click();
  await askButton(ana).click();
  await ana.getByTestId('ask-input').fill('Rename the items');
  await ana.getByTestId('ask-submit').click();
  await expect(editor(ana)).toContainText('Roadmap, team lunch, hacking');
  await expect(editor(gerard)).toContainText('Roadmap, team lunch, hacking');

  for (const [page, names, asker] of [
    [ana, ['Gerard', 'jot AI'], 'You'],
    [gerard, ['You', 'jot AI'], 'Ana'],
  ] as const) {
    await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('blame-name')).toHaveText([...names]);
    const box = await editor(page).getByText('Roadmap, team lunch, hacking').boundingBox();
    await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
    await expect(page.getByTestId('blame-card')).toContainText(`asked by ${asker}`);
  }
});

test('the target tint goes when a request settles after the field closed', async ({ context }) => {
  const page = await withFakeModel(context, { hang: true });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  const tinted = () => page.evaluate(() => CSS.highlights.has('jot-ai-target'));

  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Make it a list');
  await page.getByTestId('ask-submit').click();
  await expect(askButton(page)).toHaveText('jot AI is writing…');
  // Closing the field leaves the request running on its blocks.
  await editor(page).getByText('Plan').click();
  await expect(page.getByTestId('ask-panel')).toHaveCount(0);
  expect(await tinted()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(askButton(page)).toHaveText('Ask AI…');
  await expect.poll(tinted).toBe(false);
});

test('the target tint goes when a closed request fails', async ({ context }) => {
  const page = await withFakeModel(context, { fail: true });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Make it a list');
  await page.getByTestId('ask-submit').click();
  await editor(page).getByText('Plan').click();
  await expect(page.getByTestId('ask-panel')).toHaveCount(0);
  await expect(askButton(page)).toHaveText('Ask AI…');
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('jot-ai-target'))).toBe(false);
  await expect(editor(page)).toContainText('Demos, lunch, hack session');
});

test('without the built-in model or WebGPU, Ask AI only explains why', async ({ page }) => {
  // Playwright's Chromium has a LanguageModel of its own: take it away, and WebGPU too.
  await page.addInitScript(() => {
    delete (window as { LanguageModel?: unknown }).LanguageModel;
    Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
  });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toHaveText(
    "Ask AI runs a model on this device, and this browser can't: it has no WebGPU and no built-in AI. Try a recent Chrome, Edge or Safari.",
  );
  await expect(page.getByTestId('ask-input')).toHaveCount(0);
  await expect(page.getByTestId('ask-submit')).toHaveCount(0);
});

test("an unavailable model says the same, and isn't created", async ({ context }) => {
  const page = await withFakeModel(context, { availability: 'unavailable' });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toContainText('no WebGPU and no built-in AI');
  expect(await modelLog(page)).toMatchObject({ create: 0, prompts: [] });
});

test('Esc cancels a running request and nothing is written', async ({ context }) => {
  const page = await withFakeModel(context, { hang: true });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Make it a list');
  await page.getByTestId('ask-input').press('Enter');
  await expect(page.getByTestId('ask-meta')).toHaveText('jot AI is writing… Esc to cancel');
  await expect(askButton(page)).toHaveText('jot AI is writing…');

  await page.keyboard.press('Escape');
  await expect(askButton(page)).toHaveText('Ask AI…');
  await expect.poll(async () => (await modelLog(page)).aborted).toBe(1);
  await expect(editor(page).locator('li')).toHaveCount(0);
  await expect(editor(page)).toContainText('Demos, lunch, hack session');
});

test('a new note downloads the model on the first Ask, with progress', async ({ context }) => {
  const page = await withFakeModel(context, {
    availability: 'downloadable',
    reply: '## Lunch spots',
  });
  await page.goto('/new');
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/);
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await editor(page).click();
  await askButton(page).click();
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Writes into the empty line · Gemini Nano downloads to this device on your first Ask',
  );
  await page.getByTestId('ask-input').fill('A heading for lunch');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-meta')).toContainText('Downloading Gemini Nano');
  await expect(editor(page).locator('h2')).toHaveText('Lunch spots');
});
