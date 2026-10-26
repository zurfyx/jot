import type { BrowserContext, Page } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';

interface FakeModel {
  availability?: 'available' | 'downloadable' | 'unavailable';
  reply?: string;
  /** The prompt waits until it is aborted. */
  hang?: boolean;
}

interface ModelLog {
  availability: number;
  create: number;
  prompts: string[];
  aborted: number;
}

/**
 * A fake `window.LanguageModel` with Chrome's shape, installed before the
 * page loads. It logs every call in `window.__ai`.
 */
async function withFakeModel(context: BrowserContext, model: FakeModel): Promise<Page> {
  await context.addInitScript((options: FakeModel) => {
    const log: ModelLog = { availability: 0, create: 0, prompts: [], aborted: 0 };
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    Object.assign(window, {
      __ai: log,
      LanguageModel: {
        availability() {
          log.availability += 1;
          return Promise.resolve(options.availability ?? 'available');
        },
        async create(createOptions: { monitor?: (m: EventTarget) => void } = {}) {
          log.create += 1;
          const monitor = new EventTarget();
          createOptions.monitor?.(monitor);
          if ((options.availability ?? 'available') !== 'available') {
            for (const loaded of [0.4, 1]) {
              await wait(250);
              monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
            }
          }
          return {
            async prompt(input: string, { signal }: { signal?: AbortSignal } = {}) {
              log.prompts.push(input);
              if (options.hang) {
                return new Promise<string>((_resolve, reject) => {
                  signal?.addEventListener('abort', () => {
                    log.aborted += 1;
                    reject(new DOMException('Aborted', 'AbortError'));
                  });
                });
              }
              await wait(300);
              return options.reply ?? '';
            },
            destroy() {},
          };
        },
      },
    });
  }, model);
  return context.newPage();
}

function modelLog(page: Page): Promise<ModelLog> {
  return page.evaluate(() => (window as unknown as { __ai: ModelLog }).__ai);
}

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
    'Rewrites this block · runs on this device',
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

test('without the built-in model, Ask AI only explains what it needs', async ({ page }) => {
  // Playwright's Chromium has a LanguageModel of its own: take it away.
  await page.addInitScript(() => {
    delete (window as { LanguageModel?: unknown }).LanguageModel;
  });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toHaveText(
    "Needs Chrome's built-in AI (Gemini Nano). Open jot in Chrome on desktop.",
  );
  await expect(page.getByTestId('ask-input')).toHaveCount(0);
  await expect(page.getByTestId('ask-submit')).toHaveCount(0);
});

test("an unavailable model says the same, and isn't created", async ({ context }) => {
  const page = await withFakeModel(context, { availability: 'unavailable' });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toBeVisible();
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

test('a draft downloads the model on the first Ask, with progress', async ({ context }) => {
  const page = await withFakeModel(context, {
    availability: 'downloadable',
    reply: '## Lunch spots',
  });
  await page.goto('/new');
  await expect(page.getByTestId('status-pill')).toHaveText('Only on this device');
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
