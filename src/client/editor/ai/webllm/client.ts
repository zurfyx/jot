/**
 * The page's side of the WebLLM models (D26): a backend per model, over one
 * worker per page. The worker (and with it WebLLM) starts only to load a
 * model, on an Ask; never on page load. What is downloaded comes from Cache
 * Storage (cache.ts), which the page reads and clears itself.
 */
import { type AiBackend, type AiSession, ModelError } from '../backend';
import { type ModelInfo, type WebLLMBuild, webllmMaxPassage } from '../models';
import type { AiAvailability } from '../prompt-api';
import { cacheState, clearCache } from './cache';
import {
  type ChatResult,
  type FromWorker,
  type LoadStage,
  NEEDS_DOWNLOAD,
  type ToWorker,
} from './protocol';

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
 * stops), and loads again from the cache on the next Ask. A worker with no
 * model loaded stops as soon as it has nothing to do.
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
  onProgress?: (progress: number, stage: LoadStage) => void;
}

/** One worker per page; it loads one model at a time. */
export class WebLLMEngine {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** The build the worker has in memory. */
  loaded: string | null = null;
  /** Clearing a cancelled download's files, per build: a later load waits for it. */
  private clearing = new Map<string, Promise<void>>();

  /**
   * Clears `id`'s files with `clear`, and makes every later load of `id` wait
   * until that is done, so a retry's download is never deleted by the
   * cleanup of the request it replaced.
   */
  clearAfterCancel(id: string, clear: () => Promise<void>): Promise<void> {
    const before = this.clearing.get(id) ?? Promise.resolve();
    const done = before.then(clear).catch(() => undefined);
    this.clearing.set(id, done);
    void done.then(() => {
      if (this.clearing.get(id) === done) {
        this.clearing.delete(id);
      }
    });
    return done;
  }

  /** Resolves once no cleanup of `id` is pending. */
  async cleared(id: string): Promise<void> {
    let pending = this.clearing.get(id);
    while (pending !== undefined) {
      await pending;
      const next = this.clearing.get(id);
      pending = next === pending ? undefined : next;
    }
  }

  /** Whether a worker is running (for tests and the idle rule). */
  get running(): boolean {
    return this.worker !== null;
  }

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
        pending.onProgress?.(message.progress, message.stage);
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
    onProgress?: (progress: number, stage: LoadStage) => void,
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

  /**
   * After every request (its caller has updated `loaded`): a worker with no
   * model stops now; one with a model stops IDLE_UNLOAD_MS after its last use.
   */
  private settled(): void {
    if (this.worker === null || this.pending.size > 0) {
      return;
    }
    if (this.loaded === null) {
      this.stop();
    } else {
      this.touch();
    }
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

  /**
   * Loads `build`. `offline`: every file is cached and nobody agreed to a
   * download, so the worker refuses the network. Aborting stops the worker.
   */
  async load(
    build: WebLLMBuild,
    options: {
      signal: AbortSignal;
      offline: boolean;
      onProgress: (progress: number, stage: LoadStage) => void;
    },
  ): Promise<void> {
    const { signal } = options;
    if (this.loaded === build.id && this.worker !== null) {
      this.touch();
      return;
    }
    signal.throwIfAborted();
    // Another build may be loaded: it goes first.
    this.loaded = null;
    const onAbort = () => this.stop();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.request<null>(
        { id: this.nextId++, type: 'load', build, offline: options.offline },
        options.onProgress,
      );
      this.loaded = build.id;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.settled();
    }
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
      this.settled();
    }
  }
}

let shared: WebLLMEngine | null = null;

/** The page's one WebLLM engine. */
export function webllmEngine(): WebLLMEngine {
  shared ??= new WebLLMEngine();
  return shared;
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

/** What a backend needs of Cache Storage; tests stand in for it. */
export interface CacheAccess {
  state: typeof cacheState;
  clear: typeof clearCache;
}

const CACHE: CacheAccess = {
  state: (build) => cacheState(build),
  clear: (build) => clearCache(build),
};

/** A WebLLM model (`info.webllm`, built as `build`) as a backend. */
export function webllmBackend(
  info: ModelInfo,
  build: WebLLMBuild,
  engine: WebLLMEngine = webllmEngine(),
  cache: CacheAccess = CACHE,
): AiBackend {
  const contextWindow = info.webllm?.contextWindow ?? 4096;
  const maxPassage = webllmMaxPassage(contextWindow);
  return {
    id: info.id,
    build: build.id,
    name: info.name,
    consent: info.download,
    maxPassage,
    async availability(): Promise<AiAvailability> {
      if (engine.loaded === build.id) {
        return 'available';
      }
      return (await cache.state(build)) === 'complete' ? 'available' : 'downloadable';
    },
    async open({ system, signal, onProgress, consented }): Promise<AiSession> {
      let download = false;
      // A cancelled download of this build may still be clearing its files.
      await engine.cleared(build.id);
      signal.throwIfAborted();
      if (engine.loaded !== build.id) {
        // Every file must be here, or the person must have agreed to fetch
        // what is missing: nothing downloads without a yes.
        download = (await cache.state(build)) !== 'complete';
        signal.throwIfAborted();
        if (download && !consented) {
          throw new ModelError('consent');
        }
      }
      try {
        await engine.load(build, {
          signal,
          offline: !download,
          onProgress(progress, stage) {
            // A download fetches, then loads onto the GPU; a cached model only loads.
            onProgress(progress, !download || stage === 'load' || stage === 'finish');
          },
        });
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          if (download) {
            // A cancelled download leaves no partial files behind; the next
            // load of this build waits until they are gone.
            void engine.clearAfterCancel(build.id, () => cache.clear(build));
          }
          throw error;
        }
        if (error instanceof Error && error.name === NEEDS_DOWNLOAD) {
          throw new ModelError('consent');
        }
        console.warn('jot: the model could not load', error);
        throw new ModelError('load', error instanceof Error ? error.message : String(error));
      }
      if (download) {
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
