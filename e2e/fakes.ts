import type { BrowserContext, Page, Request } from '@playwright/test';

/**
 * Fakes for Ask AI, installed before the page loads: Chrome's built-in model
 * (`withFakeModel`), and a whole device with WebGPU, a phone or a laptop and a
 * stub for jot's WebLLM worker (`withDevice`). The AI specs and the visual
 * suite share them.
 */

export interface FakeModel {
  availability?: 'available' | 'downloadable' | 'unavailable';
  reply?: string;
  /** The prompt waits until it is aborted. */
  hang?: boolean;
  /** The prompt fails after a moment. */
  fail?: boolean;
  /**
   * WebGPU, which would make a WebLLM model the default where Chrome's isn't
   * ready (e2e/ai-models.spec.ts covers those). Off unless asked for.
   */
  webgpu?: boolean;
}

export interface ModelLog {
  availability: number;
  create: number;
  prompts: string[];
  aborted: number;
}

/**
 * A fake `window.LanguageModel` with Chrome's shape, installed before the
 * page loads. It logs every call in `window.__ai`.
 */
export async function withFakeModel(context: BrowserContext, model: FakeModel): Promise<Page> {
  await context.addInitScript((options: FakeModel) => {
    if (!options.webgpu) {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        configurable: true,
        get: () => undefined,
      });
    }
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
              await wait(options.fail ? 800 : 300);
              if (options.fail) {
                throw new Error('The model crashed');
              }
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

export function modelLog(page: Page): Promise<ModelLog> {
  return page.evaluate(() => (window as unknown as { __ai: ModelLog }).__ai);
}

/**
 * Ask AI's three models (D26), with the device faked before the page loads:
 * Chrome's built-in model present or not, WebGPU present or not, a phone or
 * a laptop, and a stub for jot's WebLLM worker (the dev-only
 * `window.__jotWebLLMWorker` hook) that speaks its protocol without WebLLM,
 * with WebLLM's real progress stages, and writes the files WebLLM would into
 * the page's real Cache Storage, where jot reads what is downloaded.
 */
export interface FakeDevice {
  /** Chrome's built-in model; absent by default. */
  prompt?: 'available';
  /** WebGPU with a shader-f16 adapter; on by default. */
  webgpu?: boolean;
  /** A phone, by UA-CH. */
  mobile?: boolean;
  /** jot AI's reply. */
  reply?: string;
  /** The download writes the first shard, then waits until the worker is stopped. */
  hangLoad?: boolean;
  /** Milliseconds between progress reports (300 by default). */
  stepMs?: number;
}

export interface WorkerLog {
  spawned: number;
  terminated: number;
  sent: string[];
  loads: { id: string; offline: boolean }[];
  prompts: string[];
}

export interface Build {
  id: string;
  url: string;
  lib: string;
}

export const SMALL: Build = {
  id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  url: 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  lib: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
};

/**
 * Writes WebLLM's files for `build` into Cache Storage, as WebLLM lays them
 * out: all of them, all but the WebGPU library, or the manifest and one shard.
 */
export async function seedCache(page: Page, build: Build, which: 'all' | 'no-wasm' | 'partial') {
  await page.evaluate(
    ({ build, which }) =>
      (window as unknown as { __seed(build: Build, which: string): Promise<void> }).__seed(
        build,
        which,
      ),
    { build, which },
  );
}

export async function withDevice(context: BrowserContext, device: FakeDevice): Promise<Page> {
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

    const seed = async (build: Build, which: string) => {
      const base = `${build.url}/resolve/main/`;
      const model = await caches.open('webllm/model');
      const put = (cache: Cache, url: string, body: unknown) =>
        cache.put(url, new Response(typeof body === 'string' ? body : JSON.stringify(body)));
      await put(model, `${base}tensor-cache.json`, {
        records: [{ dataPath: 'params_shard_0.bin' }, { dataPath: 'params_shard_1.bin' }],
      });
      await put(model, `${base}params_shard_0.bin`, 'weights');
      if (which === 'partial') {
        return;
      }
      await put(model, `${base}params_shard_1.bin`, 'weights');
      await put(model, `${base}tokenizer.json`, '{}');
      await put(await caches.open('webllm/config'), `${base}mlc-chat-config.json`, {
        tokenizer_files: ['tokenizer.json'],
      });
      if (which === 'all') {
        await put(await caches.open('webllm/wasm'), build.lib, 'wasm');
      }
    };

    const log: WorkerLog = { spawned: 0, terminated: 0, sent: [], loads: [], prompts: [] };
    /** The time between two progress reports, or before a reply. */
    const step = () => new Promise((resolve) => setTimeout(resolve, options.stepMs ?? 300));
    Object.assign(window, {
      __webllm: log,
      __seed: seed,
      __jotWebLLMWorker() {
        log.spawned += 1;
        const target = new EventTarget();
        let stopped = false;
        const emit = (data: unknown) => {
          if (!stopped) {
            target.dispatchEvent(new MessageEvent('message', { data }));
          }
        };
        type Message = {
          id: number;
          type: string;
          build?: Build;
          offline?: boolean;
          prompt?: string;
        };
        return {
          addEventListener: (type: string, listener: EventListener) =>
            target.addEventListener(type, listener),
          async postMessage(message: Message) {
            log.sent.push(message.type);
            const { id } = message;
            switch (message.type) {
              case 'load': {
                const build = message.build!;
                log.loads.push({ id: build.id, offline: message.offline! });
                emit({ id, type: 'progress', progress: 0, stage: 'start' });
                if (!message.offline) {
                  // WebLLM fetches the shards into the cache, then loads them.
                  for (const progress of [0.25, 0.5]) {
                    await step();
                    if (progress === 0.25) {
                      await seed(build, 'partial');
                    }
                    emit({ id, type: 'progress', progress, stage: 'fetch' });
                    if (options.hangLoad && progress === 0.5) {
                      return;
                    }
                  }
                  await seed(build, 'all');
                }
                for (const progress of [0.5, 1]) {
                  await step();
                  emit({ id, type: 'progress', progress, stage: 'load' });
                }
                emit({ id, type: 'progress', progress: 1, stage: 'finish' });
                emit({ id, type: 'done', value: null });
                break;
              }
              case 'chat':
                log.prompts.push(message.prompt!);
                await step();
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

export function workerLog(page: Page): Promise<WorkerLog> {
  return page.evaluate(() => (window as unknown as { __webllm: WorkerLog }).__webllm);
}

/** Requests for WebLLM itself or jot's worker that loads it. */
export function watchWebLLMRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (/webllm\/worker|@mlc-ai|web-llm|huggingface|binary-mlc-llm-libs/.test(request.url())) {
      requests.push(request);
    }
  });
  return requests;
}
