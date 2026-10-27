/**
 * Messages between the page and jot's WebLLM worker (worker.ts). The page
 * never imports WebLLM: its bundle (about 2 MB compressed, which doesn't
 * tree-shake) loads only inside the worker, on the first use of a WebLLM
 * model. What is downloaded the page reads from Cache Storage itself
 * (cache.ts), without the worker.
 */
import type { WebLLMBuild } from '../models';

export type ToWorker =
  | {
      id: number;
      type: 'load';
      build: WebLLMBuild;
      /**
       * Every file is in the cache, and the person didn't agree to a
       * download: the load must not touch the network, and fails with
       * `NeedsDownload` if it would.
       */
      offline: boolean;
    }
  | {
      id: number;
      type: 'chat';
      system: string;
      prompt: string;
      maxTokens: number;
    }
  /** Stops a running `chat`, which then answers with what it had. */
  | { type: 'interrupt' };

export interface ChatResult {
  text: string;
  /** `length` when the reply ran into `maxTokens` or the context window. */
  finish: string | null;
}

/**
 * Where a load is, from WebLLM's progress report (its `text` is the only field
 * that says): `start`, `fetch` (shards from the network into the cache),
 * `load` (from the cache onto the GPU; its progress starts again from 0) and
 * `finish`.
 */
export type LoadStage = 'start' | 'fetch' | 'load' | 'finish';

export function stageOf(text: string): LoadStage {
  if (text.startsWith('Fetching param cache')) {
    return 'fetch';
  }
  if (text.startsWith('Loading model from cache')) {
    return 'load';
  }
  if (text.startsWith('Finish loading')) {
    return 'finish';
  }
  return 'start';
}

/** The error name a load answers with when it would need the network. */
export const NEEDS_DOWNLOAD = 'NeedsDownload';

export type FromWorker =
  | { id: number; type: 'progress'; progress: number; stage: LoadStage }
  | { id: number; type: 'done'; value: ChatResult | null }
  | { id: number; type: 'error'; name: string; message: string };
