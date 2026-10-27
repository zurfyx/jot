/**
 * The page's side of the WebLLM models (D26): a backend per model, over one
 * worker per page. The worker (and with it WebLLM) starts only when a
 * WebLLM model is used: an Ask, or Delete in the AI model setting. Never on
 * page load.
 */
import { type AiBackend, type AiSession, ModelError } from '../backend';
import { type ModelInfo, webllmMaxPassage } from '../models';
import type { AiAvailability } from '../prompt-api';
import type { ChatResult, FromWorker, ToWorker } from './protocol';

/** What the page needs of a Worker; e2e tests stand in for it (see `spawn`). */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

declare global {
  interface Window {
    /** Dev builds only: e2e tests replace the worker with a stub engine. */
    __jotWebLLMWorker?: () => WorkerLike;
  }
}

/**
 * The model leaves GPU memory this long after its last use (the worker
 * stops), and loads again from the cache on the next Ask.
 */
export const IDLE_UNLOAD_MS = 5 * 60_000;

function spawn(): WorkerLike {
  const stub = import.meta.env.DEV ? window.__jotWebLLMWorker : undefined;
  if (stub !== undefined) {
    return stub();
  }
  return new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'jot AI model',
  }) as WorkerLike;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  onProgress?: (progress: number, loading: boolean) => void;
}

/** One worker per page; it loads one model at a time. */
export class WebLLMEngine {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** The model the worker has in memory. */
  loaded: string | null = null;

  private start(): WorkerLike {
    if (this.worker !== null) {
      return this.worker;
    }
    const worker = spawn();
    worker.addEventListener('message', (event) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      if (message.type === 'progress') {
        pending.onProgress?.(message.progress, message.loading);
        return;
      }
      this.pending.delete(message.id);
      if (message.type === 'done') {
        pending.resolve(message.value);
      } else {
        pending.reject(
          message.name === 'ContextWindowSizeExceededError'
            ? new ModelError('too-long', message.message)
            : Object.assign(new Error(message.message), { name: message.name }),
        );
      }
    });
    // The worker couldn't start or crashed (its script failed, or the GPU ran out).
    worker.addEventListener('error', () => this.stop(new ModelError('load', 'The worker failed')));
    this.worker = worker;
    return worker;
  }

  private request<T>(
    message: ToWorker & { id: number },
    onProgress?: (progress: number, loading: boolean) => void,
  ): Promise<T> {
    const worker = this.start();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(message.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage(message);
    });
  }

  /** Stops the worker: whatever it was doing ends with `error`. */
  stop(error: unknown = abortError()): void {
    if (this.idle !== null) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    this.worker?.terminate();
    this.worker = null;
    this.loaded = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const { reject } of pending) {
      reject(error);
    }
  }

  private touch(): void {
    if (this.idle !== null) {
      clearTimeout(this.idle);
    }
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.pending.size === 0) {
        this.stop();
      }
    }, IDLE_UNLOAD_MS);
  }

  has(model: string): Promise<boolean> {
    return this.request<boolean>({ id: this.nextId++, type: 'has', model });
  }

  async delete(model: string): Promise<void> {
    await this.request<null>({ id: this.nextId++, type: 'delete', model });
    if (this.loaded === model) {
      this.loaded = null;
    }
  }

  /** Loads `model`, downloading what the cache lacks. Aborting stops the worker. */
  async load(
    model: string,
    signal: AbortSignal,
    onProgress: (progress: number, loading: boolean) => void,
  ): Promise<void> {
    if (this.loaded === model && this.worker !== null) {
      this.touch();
      return;
    }
    signal.throwIfAborted();
    const onAbort = () => this.stop();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.request<null>({ id: this.nextId++, type: 'load', model }, onProgress);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    this.loaded = model;
    this.touch();
  }

  /** One rewrite. Aborting interrupts it; the model stays loaded. */
  async chat(
    system: string,
    prompt: string,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<ChatResult> {
    signal.throwIfAborted();
    const onAbort = () => this.worker?.postMessage({ type: 'interrupt' });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await this.request<ChatResult>({
        id: this.nextId++,
        type: 'chat',
        system,
        prompt,
        maxTokens,
      });
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.touch();
    }
  }
}

let shared: WebLLMEngine | null = null;

/** The page's one WebLLM engine. */
export function webllmEngine(): WebLLMEngine {
  shared ??= new WebLLMEngine();
  return shared;
}

const DOWNLOADED_KEY = 'jot:ai-downloaded';

/**
 * WebLLM model ids this browser downloaded, as jot remembers them: a hint
 * that spares loading WebLLM to look in its cache. The cache may have been
 * evicted since (Safari does that), so an Ask checks it before loading.
 */
export function downloadedModels(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DOWNLOADED_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markDownloaded(model: string, downloaded: boolean): void {
  const models = downloadedModels();
  if (downloaded) {
    models.add(model);
  } else {
    models.delete(model);
  }
  try {
    localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...models]));
  } catch {
    // Storage is off: the next Ask checks the cache anyway.
  }
}

/** Removes a downloaded model from this browser. */
export async function deleteModel(model: string): Promise<void> {
  await webllmEngine().delete(model);
  markDownloaded(model, false);
}

/** Qwen3 may still open its reply with an empty thinking block. */
export function stripThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '');
}

/**
 * Tokens a reply may take: what the prompt leaves of the context window, and
 * no more than a rewrite needs (twice the prompt, and a margin for an empty
 * line). A small model that falls into a loop stops in seconds, not minutes,
 * and the reply is refused as cut off.
 */
export function replyBudget(contextWindow: number, system: string, input: string): number {
  const promptTokens = Math.ceil((system.length + input.length) / 3);
  const inputTokens = Math.ceil(input.length / 3);
  return Math.max(128, Math.min(contextWindow - promptTokens - 64, inputTokens * 2 + 384));
}

/** A WebLLM model (`info.webllm`, built as `model`) as a backend. */
export function webllmBackend(
  info: ModelInfo,
  model: string,
  engine: WebLLMEngine = webllmEngine(),
): AiBackend {
  const contextWindow = info.webllm?.contextWindow ?? 4096;
  const maxPassage = webllmMaxPassage(contextWindow);
  return {
    id: info.id,
    name: info.name,
    consent: info.download,
    maxPassage,
    availability(): Promise<AiAvailability> {
      return Promise.resolve(
        engine.loaded === model || downloadedModels().has(model) ? 'available' : 'downloadable',
      );
    },
    async open({ system, signal, onProgress, consented }): Promise<AiSession> {
      if (!consented && engine.loaded !== model) {
        // jot remembers it downloaded: make sure the cache still has it, so
        // nothing downloads without a yes.
        const here = downloadedModels().has(model) && (await engine.has(model));
        signal.throwIfAborted();
        if (!here) {
          markDownloaded(model, false);
          throw new ModelError('consent');
        }
      }
      try {
        await engine.load(model, signal, onProgress);
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }
        console.warn('jot: the model could not load', error);
        throw new ModelError('load', error instanceof Error ? error.message : String(error));
      }
      markDownloaded(model, true);
      if (consented) {
        // Ask the browser to keep the download (Safari evicts storage otherwise).
        void navigator.storage?.persist?.().catch(() => false);
      }
      return {
        async prompt(input, options = {}) {
          const promptSignal = options.signal ?? new AbortController().signal;
          const maxTokens = replyBudget(contextWindow, system, input);
          const result = await engine.chat(system, input, maxTokens, promptSignal);
          if (result.finish === 'length') {
            throw new ModelError('cut-off');
          }
          return stripThinking(result.text);
        },
        destroy() {
          // The model stays loaded for the next Ask, until IDLE_UNLOAD_MS.
        },
      };
    },
  };
}
