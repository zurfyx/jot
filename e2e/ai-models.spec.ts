import type { BrowserContext, Page, Request } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';

/**
 * Ask AI's three models (D26), with the device faked before the page loads:
 * Chrome's built-in model present or not, WebGPU present or not, a phone or
 * a laptop, and a stub for jot's WebLLM worker (the dev-only
 * `window.__jotWebLLMWorker` hook) that speaks its protocol without WebLLM.
 */
interface FakeDevice {
  /** Chrome's built-in model; absent by default. */
  prompt?: 'available';
  /** WebGPU with a shader-f16 adapter; on by default. */
  webgpu?: boolean;
  /** A phone, by UA-CH. */
  mobile?: boolean;
  /** jot AI's reply. */
  reply?: string;
  /** The download waits until the worker is stopped. */
  hangLoad?: boolean;
}

interface WorkerLog {
  spawned: number;
  terminated: number;
  sent: string[];
  loaded: string[];
  prompts: string[];
  deleted: string[];
}

async function withDevice(context: BrowserContext, device: FakeDevice): Promise<Page> {
  await context.addInitScript((options: FakeDevice) => {
    if (options.prompt === 'available') {
      Object.assign(window, {
        LanguageModel: {
          availability: () => Promise.resolve('available'),
          create: () => Promise.resolve({ prompt: () => Promise.resolve('Nano'), destroy() {} }),
        },
      });
    } else {
      delete (window as { LanguageModel?: unknown }).LanguageModel;
    }
    const gpu =
      options.webgpu === false
        ? undefined
        : { requestAdapter: () => Promise.resolve({ features: new Set(['shader-f16']) }) };
    Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => gpu });
    if (options.mobile) {
      Object.defineProperty(Navigator.prototype, 'userAgentData', {
        configurable: true,
        get: () => ({ mobile: true, brands: [], platform: 'Android' }),
      });
    }

    // WebLLM's cache, kept across reloads like the real one.
    const CACHE = 'test:webllm-cache';
    const cached = (): string[] => JSON.parse(localStorage.getItem(CACHE) ?? '[]') as string[];
    const log: WorkerLog = {
      spawned: 0,
      terminated: 0,
      sent: [],
      loaded: [],
      prompts: [],
      deleted: [],
    };
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    Object.assign(window, {
      __webllm: log,
      __jotWebLLMWorker() {
        log.spawned += 1;
        const target = new EventTarget();
        let stopped = false;
        const emit = (data: unknown) => {
          if (!stopped) {
            target.dispatchEvent(new MessageEvent('message', { data }));
          }
        };
        type Message = { id: number; type: string; model?: string; prompt?: string };
        return {
          addEventListener: (type: string, listener: EventListener) =>
            target.addEventListener(type, listener),
          async postMessage(message: Message) {
            log.sent.push(message.type);
            const { id } = message;
            switch (message.type) {
              case 'has':
                emit({ id, type: 'done', value: cached().includes(message.model!) });
                break;
              case 'delete':
                log.deleted.push(message.model!);
                localStorage.setItem(
                  CACHE,
                  JSON.stringify(cached().filter((model) => model !== message.model)),
                );
                emit({ id, type: 'done', value: null });
                break;
              case 'load':
                for (const progress of [0.25, 0.5, 1]) {
                  await wait(300);
                  emit({ id, type: 'progress', progress, text: 'Fetching' });
                  if (options.hangLoad && progress === 0.5) {
                    return;
                  }
                }
                log.loaded.push(message.model!);
                localStorage.setItem(CACHE, JSON.stringify([...cached(), message.model!]));
                emit({ id, type: 'done', value: null });
                break;
              case 'chat':
                log.prompts.push(message.prompt!);
                await wait(300);
                emit({ id, type: 'done', value: { text: options.reply ?? '', finish: 'stop' } });
                break;
            }
          },
          terminate() {
            stopped = true;
            log.terminated += 1;
          },
        };
      },
    });
  }, device);
  return context.newPage();
}

function workerLog(page: Page): Promise<WorkerLog> {
  return page.evaluate(() => (window as unknown as { __webllm: WorkerLog }).__webllm);
}

/** Requests for WebLLM itself or jot's worker that loads it. */
function watchWebLLMRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (/webllm\/worker|@mlc-ai|web-llm|huggingface|binary-mlc-llm-libs/.test(request.url())) {
      requests.push(request);
    }
  });
  return requests;
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

async function openModels(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByTestId('ai-model-item').click();
  return page.getByTestId('model-panel');
}

test('the AI model setting lists the three, and remembers the choice', async ({ context }) => {
  const page = await withDevice(context, {});
  const requests = watchWebLLMRequests(page);
  const id = freshNoteId();
  await openNote(page, id);

  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  // A laptop without Chrome's model: the larger WebLLM model is the default.
  await expect(page.getByTestId('ai-model-item')).toContainText('Larger');
  await page.getByTestId('ai-model-item').click();
  const panel = page.getByTestId('model-panel');
  await expect(panel.getByRole('radio')).toHaveCount(3);
  await expect(panel.getByTestId('model-chrome')).toContainText('Chrome built-in');
  await expect(panel.getByTestId('model-chrome')).toContainText('Gemini Nano');
  await expect(panel.getByTestId('model-chrome-state')).toHaveText('Not supported on this device');
  await expect(panel.getByTestId('model-small')).toContainText('Qwen2.5 0.5B · 300 MB');
  await expect(panel.getByTestId('model-small')).toContainText('In the browser, best on phones');
  await expect(panel.getByTestId('model-small-state')).toHaveText('Needs download');
  await expect(panel.getByTestId('model-large')).toContainText('990 MB');
  await expect(panel.getByTestId('model-large')).toContainText('default here');
  await expect(panel.getByRole('radio', { name: /Larger/ })).toBeChecked();
  await expect(panel.getByRole('radio', { name: /Chrome built-in/ })).toBeDisabled();

  await panel.getByRole('radio', { name: /Small/ }).check();
  await expect(panel.getByRole('radio', { name: /Small/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Kept in this browser.
  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await expect(page.getByTestId('ai-model-item')).toContainText('Small');
  await page.getByTestId('ai-model-item').click();
  await expect(page.getByRole('radio', { name: /Small/ })).toBeChecked();

  // Looking at the setting loads nothing of WebLLM.
  expect(requests.map((request) => request.url())).toEqual([]);
  expect((await workerLog(page)).spawned).toBe(0);
});

test('a WebLLM model downloads only after a yes, and Not now downloads nothing', async ({
  context,
}) => {
  const page = await withDevice(context, { mobile: true, reply: 'Demos and lunch.' });
  const requests = watchWebLLMRequests(page);
  await openNote(page, freshNoteId());
  await writeTwoLines(page);

  await askButton(page).click();
  // A phone: the small model is the default.
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Rewrites this block · Qwen2.5 0.5B (300 MB) downloads after you agree',
  );
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  const consent = page.getByTestId('ask-consent');
  await expect(consent).toContainText(
    'Ask AI needs a 300 MB model on this device (Qwen2.5 0.5B). Download it?',
  );
  await expect(page.getByTestId('ask-mobile-data')).toContainText('mobile data');
  await consent.getByTestId('ask-decline').click();
  await expect(consent).toHaveCount(0);
  await expect(page.getByTestId('ask-meta')).toContainText('downloads after you agree');
  expect((await workerLog(page)).spawned).toBe(0);

  // Esc on the question closes the field, and downloads nothing either.
  await page.getByTestId('ask-submit').click();
  await expect(consent).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ask-panel')).toHaveCount(0);
  expect((await workerLog(page)).spawned).toBe(0);
  expect(requests.map((request) => request.url())).toEqual([]);
  await expect(editor(page)).toContainText('Demos, lunch, hack session');
});

test('the download shows its progress, then jot AI writes, credited in blame', async ({
  context,
}) => {
  const page = await withDevice(context, { reply: '- Roadmap\n- Team lunch\n- Hacking' });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);

  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Make it a list');
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-download').click();
  // The larger model on a laptop, in the f16 build the adapter supports.
  await expect(page.getByTestId('ask-meta')).toHaveText(
    /^Downloading Qwen3 1\.7B( · \d+%)? · Esc to cancel$/,
  );
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Downloading Qwen3 1.7B · 50% · Esc to cancel',
  );
  await expect(page.locator('.ask-meter')).toBeVisible();
  await expect(askButton(page)).toHaveText('jot AI is writing…');

  await expect(editor(page).locator('li')).toHaveText(['Roadmap', 'Team lunch', 'Hacking']);
  await expect(editor(page)).toContainText('Plan');
  const log = await workerLog(page);
  expect(log.loaded).toEqual(['Qwen3-1.7B-q4f16_1-MLC']);
  expect(log.prompts).toHaveLength(1);
  expect(log.prompts[0]).toContain('Instruction: Make it a list');
  expect(log.prompts[0]).toContain('Demos, lunch, hack session');
  await expect(page.getByTestId('remote-caret').filter({ hasText: 'jot AI' })).toHaveCount(1);

  // Blame: jot AI wrote the list, asked by this person.
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('blame-name')).toHaveText(['You', 'jot AI']);
  const box = await editor(page).getByText('Team lunch').boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
  await expect(page.getByTestId('blame-card')).toContainText('jot AI');
  await expect(page.getByTestId('blame-card')).toContainText('asked by You');

  // The setting knows it is here now, and can delete it.
  const panel = await openModels(page);
  await expect(panel.getByTestId('model-large-state')).toHaveText('Ready');
  await panel.getByTestId('model-large-delete').click();
  await expect(panel.getByTestId('model-large-state')).toHaveText('Needs download');
  expect((await workerLog(page)).deleted).toEqual(['Qwen3-1.7B-q4f16_1-MLC']);
});

test('a downloaded model loads without asking, after a reload', async ({ context }) => {
  const page = await withDevice(context, { reply: 'Demos.' });
  const id = freshNoteId();
  await openNote(page, id);
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-download').click();
  await expect(editor(page)).toContainText('Demos.');

  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  const panel = await openModels(page);
  await expect(panel.getByTestId('model-large-state')).toHaveText('Downloaded');
  await page.keyboard.press('Escape');
  await editor(page).getByText('Demos.').click();
  await askButton(page).click();
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Rewrites this block · Qwen3 1.7B, on this device',
  );
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-consent')).toHaveCount(0);
  await expect(page.getByTestId('ask-meta')).toContainText('Loading Qwen3 1.7B');
  await expect.poll(async () => (await workerLog(page)).sent).toContain('chat');
  expect((await workerLog(page)).sent.slice(0, 2)).toEqual(['has', 'load']);
});

test('Esc cancels a download: the worker stops and nothing is written', async ({ context }) => {
  const page = await withDevice(context, { hangLoad: true, reply: 'Never' });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-download').click();
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Downloading Qwen3 1.7B · 50% · Esc to cancel',
  );
  await page.keyboard.press('Escape');
  await expect(askButton(page)).toHaveText('Ask AI…');
  await expect.poll(async () => (await workerLog(page)).terminated).toBe(1);
  await expect(editor(page)).toContainText('Demos, lunch, hack session');
  await expect(page.getByTestId('remote-caret')).toHaveCount(0);
});

test("Chrome's model, when ready, is the default and needs no download", async ({ context }) => {
  const page = await withDevice(context, { prompt: 'available' });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await expect(page.getByTestId('ask-meta')).toHaveText(
    'Rewrites this block · Gemini Nano, on this device',
  );
  const panel = await openModels(page);
  await expect(panel.getByRole('radio', { name: /Chrome built-in/ })).toBeChecked();
  await expect(panel.getByTestId('model-chrome-state')).toHaveText('Ready');
  await expect(panel.getByTestId('model-chrome')).toContainText('no download');
});

test('without WebGPU or built-in AI, Ask AI explains why and the setting agrees', async ({
  context,
}) => {
  const page = await withDevice(context, { webgpu: false });
  await openNote(page, freshNoteId());
  await askButton(page).click();
  await expect(page.getByTestId('ask-unavailable')).toHaveText(
    "Ask AI runs a model on this device, and this browser can't: it has no WebGPU and no built-in AI. Try a recent Chrome, Edge or Safari.",
  );
  await expect(page.getByTestId('ask-input')).toHaveCount(0);
  const panel = await openModels(page);
  for (const id of ['chrome', 'small', 'large']) {
    await expect(panel.getByTestId(`model-${id}-state`)).toHaveText('Not supported on this device');
  }
  await expect(panel.getByRole('radio', { checked: true })).toHaveCount(0);
});
