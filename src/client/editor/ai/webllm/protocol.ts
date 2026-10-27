/**
 * Messages between the page and jot's WebLLM worker (worker.ts). The page
 * never imports WebLLM: its bundle (about 2 MB compressed, which doesn't
 * tree-shake) loads only inside the worker, on the first use of a WebLLM
 * model.
 */

export type ToWorker =
  | { id: number; type: 'has'; model: string }
  | { id: number; type: 'delete'; model: string }
  | { id: number; type: 'load'; model: string }
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

export type FromWorker =
  /**
   * `loading`: WebLLM has fetched the files and is loading them onto the GPU
   * (its progress starts again from 0 there).
   */
  | { id: number; type: 'progress'; progress: number; loading: boolean; text: string }
  | { id: number; type: 'done'; value: boolean | ChatResult | null }
  | { id: number; type: 'error'; name: string; message: string };
