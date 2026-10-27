import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelError } from '../backend';
import { type CacheState, MODELS, type WebLLMBuild } from '../models';
import {
  type CacheAccess,
  IDLE_UNLOAD_MS,
  replyBudget,
  stripThinking,
  WebLLMEngine,
  webllmBackend,
  type WorkerLike,
} from './client';
import type { ChatResult, FromWorker, LoadStage, ToWorker } from './protocol';

const SMALL = MODELS.small.webllm!.f16;

/**
 * A stand-in for jot's WebLLM worker, speaking its protocol with WebLLM's
 * real progress texts (the stage is parsed from them in the worker).
 */
function fakeWorker(
  options: {
    reply?: ChatResult;
    hangLoad?: boolean;
    /** The load fails with this error name (the worker's offline guard says NeedsDownload). */
    failLoad?: string;
    /** Stages the load reports, in order. */
    stages?: LoadStage[];
  } = {},
) {
  const log = { sent: [] as ToWorker[], terminated: 0, spawned: 0 };
  const spawn = (): WorkerLike => {
    log.spawned += 1;
    const listeners: ((event: MessageEvent<FromWorker>) => void)[] = [];
    let stopped = false;
    const emit = (data: FromWorker) =>
      queueMicrotask(() => {
        if (!stopped) {
          listeners.forEach((listener) => listener({ data } as MessageEvent));
        }
      });
    return {
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') {
          listeners.push(listener as (event: MessageEvent<FromWorker>) => void);
        }
      },
      postMessage(message) {
        log.sent.push(message);
        switch (message.type) {
          case 'load':
            for (const [index, stage] of (options.stages ?? ['start', 'fetch', 'load']).entries()) {
              emit({ id: message.id, type: 'progress', progress: index / 2, stage });
            }
            if (options.failLoad !== undefined) {
              emit({ id: message.id, type: 'error', name: options.failLoad, message: 'no' });
            } else if (!options.hangLoad) {
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
        stopped = true;
        log.terminated += 1;
      },
    };
  };
  return { spawn, log };
}

/** Cache Storage as the backend sees it: a state per build, and clears. */
function fakeCache(initial: CacheState) {
  let state = initial;
  const cleared: string[] = [];
  const access: CacheAccess = {
    state: () => Promise.resolve(state),
    clear: (build: WebLLMBuild) => {
      cleared.push(build.id);
      state = 'none';
      return Promise.resolve();
    },
  };
  return {
    access,
    cleared,
    set(next: CacheState) {
      state = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(worker: ReturnType<typeof fakeWorker>, cached: CacheState) {
  vi.stubGlobal('window', { __jotWebLLMWorker: worker.spawn });
  const engine = new WebLLMEngine();
  const cache = fakeCache(cached);
  const backend = webllmBackend(MODELS.small, SMALL, engine, cache.access);
  return { engine, backend, cache };
}

const open = (backend: ReturnType<typeof webllmBackend>, consented: boolean) => {
  const progress: [number | null, boolean | undefined][] = [];
  const controller = new AbortController();
  const opened = backend.open({
    system: 'You are jot AI.',
    signal: controller.signal,
    consented,
    onProgress: (value, loading) => progress.push([value, loading]),
  });
  return { opened, progress, controller };
};

describe('the WebLLM backend', () => {
  it('starts no worker to say a model needs downloading, or is partly there', async () => {
    for (const cached of ['none', 'partial'] as const) {
      const worker = fakeWorker();
      const { backend } = setup(worker, cached);
      expect(backend.build).toBe(SMALL.id);
      expect(backend.consent).toEqual({ bytes: 295_000_000, text: '300 MB' });
      expect(await backend.availability()).toBe('downloadable');
      await expect(open(backend, false).opened).rejects.toEqual(new ModelError('consent'));
      expect(worker.log.spawned).toBe(0);
    }
  });

  it('downloads after a yes: Downloading while it fetches, Loading once it loads', async () => {
    const worker = fakeWorker();
    const { backend, engine, cache } = setup(worker, 'partial');
    const { opened, progress } = open(backend, true);
    const session = await opened;
    expect(progress).toEqual([
      [0, false],
      [0.5, false],
      [1, true],
    ]);
    expect(worker.log.sent[0]).toMatchObject({ type: 'load', build: SMALL, offline: false });
    expect(engine.loaded).toBe(SMALL.id);
    cache.set('complete');
    expect(await backend.availability()).toBe('available');
    expect(await session.prompt('Shorter')).toBe('Demos.');
    expect(worker.log.sent.find((message) => message.type === 'chat')).toMatchObject({
      system: 'You are jot AI.',
      prompt: 'Shorter',
    });
    engine.stop();
  });

  it('loads a cached model offline and labels all of it Loading, from the first report', async () => {
    const worker = fakeWorker({ stages: ['start', 'fetch', 'load', 'finish'] });
    const { backend, engine } = setup(worker, 'complete');
    expect(await backend.availability()).toBe('available');
    const { opened, progress } = open(backend, false);
    await opened;
    expect(worker.log.sent[0]).toMatchObject({ type: 'load', offline: true });
    expect(progress.map(([, loading]) => loading)).toEqual([true, true, true, true]);
    engine.stop();
  });

  it('asks for consent when a cached load would have needed the network', async () => {
    const worker = fakeWorker({ failLoad: 'NeedsDownload' });
    const { backend, engine } = setup(worker, 'complete');
    await expect(open(backend, false).opened).rejects.toEqual(new ModelError('consent'));
    // A worker with no model stops at once.
    expect(engine.running).toBe(false);
    expect(worker.log.terminated).toBe(1);
  });

  it('stops the worker and clears the partial files when a download is cancelled', async () => {
    const worker = fakeWorker({ hangLoad: true });
    const { backend, engine, cache } = setup(worker, 'none');
    const { opened, controller } = open(backend, true);
    await vi.waitFor(() => expect(worker.log.sent.some((m) => m.type === 'load')).toBe(true));
    controller.abort();
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.log.terminated).toBe(1);
    expect(engine.loaded).toBeNull();
    expect(cache.cleared).toEqual([SMALL.id]);
  });

  it('keeps the files when a cached load is cancelled', async () => {
    const worker = fakeWorker({ hangLoad: true });
    const { backend, cache } = setup(worker, 'complete');
    const { opened, controller } = open(backend, false);
    await vi.waitFor(() => expect(worker.log.sent.some((m) => m.type === 'load')).toBe(true));
    controller.abort();
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    expect(cache.cleared).toEqual([]);
  });

  it('interrupts a reply on abort, keeping the model loaded', async () => {
    const worker = fakeWorker();
    const { backend, engine } = setup(worker, 'complete');
    const session = await open(backend, false).opened;
    const controller = new AbortController();
    const asked = session.prompt('Shorter', { signal: controller.signal });
    controller.abort();
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.log.sent.at(-1)).toEqual({ type: 'interrupt' });
    expect(worker.log.terminated).toBe(0);
    expect(engine.loaded).toBe(SMALL.id);
    engine.stop();
  });

  it('refuses a reply cut off by the context window', async () => {
    const worker = fakeWorker({ reply: { text: '- Demos\n- Lun', finish: 'length' } });
    const { backend, engine } = setup(worker, 'complete');
    const session = await open(backend, false).opened;
    await expect(session.prompt('Shorter')).rejects.toEqual(new ModelError('cut-off'));
    engine.stop();
  });

  it('passes the context window as a passage limit', () => {
    const { backend } = setup(fakeWorker(), 'none');
    expect(backend.maxPassage).toBe(5544);
  });
});

describe('the worker', () => {
  it('stops five idle minutes after its last use, and a reply resets the clock', async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const { backend, engine } = setup(worker, 'complete');
    const session = await open(backend, false).opened;
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1000);
    expect(engine.running).toBe(true);
    await session.prompt('Shorter');
    await vi.advanceTimersByTimeAsync(IDLE_UNLOAD_MS - 1000);
    expect(engine.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.running).toBe(false);
    expect(engine.loaded).toBeNull();
    expect(worker.log.terminated).toBe(1);
  });

  it('stops at once when a load fails and no model is loaded', async () => {
    const worker = fakeWorker({ failLoad: 'Error' });
    const { backend, engine } = setup(worker, 'complete');
    await expect(open(backend, false).opened).rejects.toEqual(new ModelError('load', 'no'));
    expect(engine.running).toBe(false);
    expect(worker.log.terminated).toBe(1);
  });
});

describe("WebLLM's prebuilt models", () => {
  it('still include both builds of Small and Larger, at the URLs and context window jot plans for', async () => {
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    for (const id of ['small', 'large'] as const) {
      const model = MODELS[id].webllm!;
      for (const build of [model.f16, model.f32]) {
        const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === build.id);
        expect(record, build.id).toBeDefined();
        // jot reads Cache Storage for these URLs without loading WebLLM.
        expect(record!.model).toBe(build.url);
        expect(record!.model_lib).toBe(build.lib);
        expect(record!.overrides?.context_window_size).toBe(model.contextWindow);
      }
    }
  });
});

describe('the worker script', () => {
  it('is served with no-referrer, which Hugging Face needs from a workers.dev Preview', () => {
    const files = import.meta.glob<string>(['/vite.config.ts', '/public/_headers'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(files['/vite.config.ts']).toContain("entryFileNames: 'assets/webllm-[name]-[hash].js'");
    expect(files['/public/_headers']).toMatch(
      /^\/assets\/webllm-\*\n {2}Referrer-Policy: no-referrer$/m,
    );
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
