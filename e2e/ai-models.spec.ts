import type { Page } from '@playwright/test';

import { SMALL, seedCache, watchWebLLMRequests, withDevice, workerLog } from './fakes';
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

  // Looking at the setting starts no worker. (With the stub installed, the
  // request check can't fail: the real worker chunk is never requested here.
  // The proof that pages don't load WebLLM is the chunk-boundary unit test in
  // src/client/docs/bundle.test.ts.)
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
  // The question takes the focus, so a screen reader reads it.
  await expect(consent.getByTestId('ask-download')).toBeFocused();
  await expect(consent.getByTestId('ask-download')).toHaveAccessibleDescription(
    'Ask AI needs a 300 MB model on this device (Qwen2.5 0.5B). Download it?',
  );
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
  // (Can't fail under the stub; see the first test.)
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
  await expect(page.getByTestId('ask-meter')).toBeVisible();
  await expect(askButton(page)).toHaveText('jot AI is writing…');
  // Fetched: WebLLM loads the files onto the GPU, and the field says so.
  await expect(page.getByTestId('ask-meta')).toHaveText(/^Loading Qwen3 1\.7B/);

  await expect(editor(page).locator('li')).toHaveText(['Roadmap', 'Team lunch', 'Hacking']);
  await expect(editor(page)).toContainText('Plan');
  const log = await workerLog(page);
  expect(log.loads).toEqual([{ id: 'Qwen3-1.7B-q4f16_1-MLC', offline: false }]);
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
  await panel.getByRole('button', { name: 'Delete Larger (Qwen3 1.7B) from this browser' }).click();
  await expect(panel.getByTestId('model-large-state')).toHaveText('Needs download');
  await expect(panel.getByTestId('model-large-delete')).toHaveCount(0);
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
  // A cached model only loads: "Loading" from the first report, never "Downloading".
  await expect(page.getByTestId('ask-meta')).toHaveText(/^Loading Qwen3 1\.7B/);
  await expect.poll(async () => (await workerLog(page)).sent).toContain('chat');
  // Loaded offline: the worker refuses the network.
  expect((await workerLog(page)).loads).toEqual([{ id: 'Qwen3-1.7B-q4f16_1-MLC', offline: true }]);
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
  // The shard it had fetched is gone too: nothing partial is left behind.
  const panel = await openModels(page);
  await expect(panel.getByTestId('model-large-state')).toHaveText('Needs download');
  expect(
    await page.evaluate(async () =>
      (await (await caches.open('webllm/model')).keys()).map((key) => key.url),
    ),
  ).toEqual([]);
});

test('Download is for the model the question named: a switch to another asks again', async ({
  context,
}) => {
  const page = await withDevice(context, { mobile: true, reply: 'Demos.' });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-consent')).toContainText('300 MB');

  // The person picks Larger while the 300 MB question is open: it is withdrawn.
  const panel = await openModels(page);
  await panel.getByRole('radio', { name: /Larger/ }).check();
  await page.keyboard.press('Escape');
  await askButton(page).click();
  await expect(page.getByTestId('ask-consent')).toHaveCount(0);
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  // The question is asked again, for 990 MB; nothing has loaded.
  await expect(page.getByTestId('ask-consent')).toContainText(
    'Ask AI needs a 990 MB model on this device (Qwen3 1.7B). Download it?',
  );
  expect((await workerLog(page)).spawned).toBe(0);
});

test('a model missing any file asks first, and a partial download can be deleted', async ({
  context,
}) => {
  const page = await withDevice(context, { mobile: true });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);

  // Weights, tokenizer and config cached, the WebGPU library not.
  await seedCache(page, SMALL, 'no-wasm');
  let panel = await openModels(page);
  await expect(panel.getByTestId('model-small-state')).toHaveText('Partly downloaded');
  await page.keyboard.press('Escape');
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-consent')).toContainText('300 MB');
  expect((await workerLog(page)).spawned).toBe(0);
  await page.keyboard.press('Escape');

  // A partial download shows Delete, which clears it.
  await seedCache(page, SMALL, 'partial');
  panel = await openModels(page);
  await expect(panel.getByTestId('model-small-state')).toHaveText('Partly downloaded');
  await panel.getByTestId('model-small-delete').click();
  await expect(panel.getByTestId('model-small-state')).toHaveText('Needs download');

  // Every file there: Downloaded.
  await seedCache(page, SMALL, 'all');
  await page.keyboard.press('Escape');
  panel = await openModels(page);
  await expect(panel.getByTestId('model-small-state')).toHaveText('Downloaded');
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

test('the setting says Downloading, then Loading, as the field does', async ({ context }) => {
  const page = await withDevice(context, { reply: 'Demos.', stepMs: 1500 });
  await openNote(page, freshNoteId());
  await writeTwoLines(page);
  await askButton(page).click();
  await page.getByTestId('ask-input').fill('Shorter');
  await page.getByTestId('ask-submit').click();
  await page.getByTestId('ask-download').click();
  await expect(page.getByTestId('ask-meta')).toHaveText(/^Downloading Qwen3 1\.7B/);
  // The request keeps going while the setting is open.
  const panel = await openModels(page);
  const state = panel.getByTestId('model-large-state');
  await expect(state).toHaveText(/^Downloading( \d+%)?$/);
  await expect(state).toHaveText(/^Loading( \d+%)?$/, { timeout: 10_000 });
  await expect(state).toHaveText('Ready', { timeout: 10_000 });
});
