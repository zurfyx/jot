import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelError } from '../backend';
import { MODELS } from '../models';
import {
  downloadedModels,
  markDownloaded,
  replyBudget,
  stripThinking,
  WebLLMEngine,
  webllmBackend,
  type WorkerLike,
} from './client';
import type { ChatResult, FromWorker, ToWorker } from './protocol';

const SMALL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

/** A stand-in for jot's WebLLM worker, speaking its protocol. */
function fakeWorker(options: { cached?: string[]; reply?: ChatResult; hangLoad?: boolean } = {}) {
  const cached = new Set(options.cached ?? []);
  const log = { sent: [] as ToWorker[], terminated: 0, spawned: 0 };
  const spawn = (): WorkerLike => {
    log.spawned += 1;
    const listeners: ((event: MessageEvent<FromWorker>) => void)[] = [];
    const emit = (data: FromWorker) =>
      queueMicrotask(() => listeners.forEach((listener) => listener({ data } as MessageEvent)));
    return {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') {
          listeners.push(listener as (event: MessageEvent<FromWorker>) => void);
        }
      },
      postMessage(message) {
        log.sent.push(message);
        switch (message.type) {
          case 'has':
            emit({ id: message.id, type: 'done', value: cached.has(message.model) });
            break;
          case 'delete':
            cached.delete(message.model);
            emit({ id: message.id, type: 'done', value: null });
            break;
          case 'load':
            emit({
              id: message.id,
              type: 'progress',
              progress: 0.5,
              loading: false,
              text: 'Fetching',
            });
            if (!options.hangLoad) {
              cached.add(message.model);
              emit({ id: message.id, type: 'done', value: null });
            }
            break;
          case 'chat':
            emit({
              id: message.id,
              type: 'done',
              value: options.reply ?? { text: 'Demos.', finish: 'stop' },
            });
            break;
          case 'interrupt':
            break;
        }
      },
      terminate() {
        log.terminated += 1;
      },
    };
  };
  return { spawn, log, cached };
}

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup(worker: ReturnType<typeof fakeWorker>) {
  vi.stubGlobal('window', { __jotWebLLMWorker: worker.spawn });
  const engine = new WebLLMEngine();
  const backend = webllmBackend(MODELS.small, SMALL, engine);
  return { engine, backend };
}

const open = (backend: ReturnType<typeof webllmBackend>, consented: boolean) => {
  const progress: (number | null)[] = [];
  const controller = new AbortController();
  const opened = backend.open({
    system: 'You are jot AI.',
    signal: controller.signal,
    consented,
    onProgress: (value) => progress.push(value),
  });
  return { opened, progress, controller };
};

describe('the WebLLM backend', () => {
  it('starts no worker to say a model needs downloading', async () => {
    const worker = fakeWorker();
    const { backend } = setup(worker);
    expect(backend.consent).toEqual({ bytes: 295_000_000, text: '300 MB' });
    expect(await backend.availability()).toBe('downloadable');
    await expect(open(backend, false).opened).rejects.toEqual(new ModelError('consent'));
    expect(worker.log.spawned).toBe(0);
  });

  it('downloads after a yes, with progress, and remembers it', async () => {
    const worker = fakeWorker();
    const { backend, engine } = setup(worker);
    const { opened, progress } = open(backend, true);
    const session = await opened;
    expect(progress).toEqual([0.5]);
    expect(engine.loaded).toBe(SMALL);
    expect(downloadedModels()).toEqual(new Set([SMALL]));
    expect(await backend.availability()).toBe('available');
    expect(await session.prompt('Shorter')).toBe('Demos.');
    const chat = worker.log.sent.find((message) => message.type === 'chat');
    expect(chat).toMatchObject({ system: 'You are jot AI.', prompt: 'Shorter' });
    engine.stop();
  });

  it('checks the cache before loading a model it remembers, and asks again when it is gone', async () => {
    markDownloaded(SMALL, true);
    const evicted = fakeWorker({ cached: [] });
    const first = setup(evicted);
    expect(await first.backend.availability()).toBe('available');
    await expect(open(first.backend, false).opened).rejects.toEqual(new ModelError('consent'));
    expect(evicted.log.sent.map((message) => message.type)).toEqual(['has']);
    expect(downloadedModels().has(SMALL)).toBe(false);
    first.engine.stop();

    markDownloaded(SMALL, true);
    const kept = fakeWorker({ cached: [SMALL] });
    const second = setup(kept);
    await open(second.backend, false).opened;
    expect(kept.log.sent.map((message) => message.type)).toEqual(['has', 'load']);
    second.engine.stop();
  });

  it('stops the worker when the download is cancelled', async () => {
    const worker = fakeWorker({ hangLoad: true });
    const { backend, engine } = setup(worker);
    const { opened, controller } = open(backend, true);
    await vi.waitFor(() => expect(worker.log.sent.some((m) => m.type === 'load')).toBe(true));
    controller.abort();
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.log.terminated).toBe(1);
    expect(engine.loaded).toBeNull();
    expect(downloadedModels().has(SMALL)).toBe(false);
  });

  it('interrupts a reply on abort, keeping the model loaded', async () => {
    const worker = fakeWorker();
    const { backend, engine } = setup(worker);
    const session = await open(backend, true).opened;
    const controller = new AbortController();
    const asked = session.prompt('Shorter', { signal: controller.signal });
    controller.abort();
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.log.sent.at(-1)).toEqual({ type: 'interrupt' });
    expect(worker.log.terminated).toBe(0);
    expect(engine.loaded).toBe(SMALL);
    engine.stop();
  });

  it('refuses a reply cut off by the context window', async () => {
    const worker = fakeWorker({ reply: { text: '- Demos\n- Lun', finish: 'length' } });
    const { backend, engine } = setup(worker);
    const session = await open(backend, true).opened;
    await expect(session.prompt('Shorter')).rejects.toEqual(new ModelError('cut-off'));
    engine.stop();
  });

  it('passes the context window as a passage limit', () => {
    const { backend } = setup(fakeWorker());
    expect(backend.maxPassage).toBe(5544);
  });
});

describe("WebLLM's prebuilt models", () => {
  it('still include both builds of Small and Larger, with the context window jot plans for', async () => {
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    for (const id of ['small', 'large'] as const) {
      const model = MODELS[id].webllm!;
      for (const build of [model.f16, model.f32]) {
        const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === build);
        expect(record, build).toBeDefined();
        expect(record!.model).toMatch(/^https:\/\/huggingface\.co\/mlc-ai\//);
        expect(record!.overrides?.context_window_size).toBe(model.contextWindow);
      }
    }
  });
});

describe('the reply budget', () => {
  it('is about twice the passage, within what the prompt leaves of the context window', () => {
    const system = 'x'.repeat(600);
    // A short passage: twice its tokens and a margin, not the whole window.
    expect(replyBudget(4096, system, 'y'.repeat(300))).toBe(200 + 384);
    // A long one: what the window has left.
    expect(replyBudget(4096, system, 'y'.repeat(5400))).toBe(4096 - 2000 - 64);
    // Never below a floor, even when the prompt overflows (WebLLM refuses it then).
    expect(replyBudget(4096, system, 'y'.repeat(20_000))).toBe(128);
  });
});

describe('Qwen3 replies', () => {
  it('lose an empty thinking block at the start, and nothing else', () => {
    expect(stripThinking('<think>\n\n</think>\n\n- Demos')).toBe('- Demos');
    expect(stripThinking('- Demos <think>x</think>')).toBe('- Demos <think>x</think>');
  });
});
