/**
 * jot's WebLLM worker: runs the model off the page's main thread, so typing
 * stays responsive while it downloads, compiles and writes. The page talks
 * to it through protocol.ts; this is the only file that imports WebLLM.
 *
 * Models and their WebGPU libraries come from WebLLM's default hosts
 * (Hugging Face and raw.githubusercontent.com), and WebLLM keeps them in the
 * browser's Cache Storage (cache.ts reads it from the page).
 */
import { type InitProgressReport, MLCEngine } from '@mlc-ai/web-llm';

import {
  type ChatResult,
  type FromWorker,
  NEEDS_DOWNLOAD,
  stageOf,
  type ToWorker,
} from './protocol';

interface WorkerScope {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
  fetch: typeof fetch;
}

const scope = self as unknown as WorkerScope;

let engine: MLCEngine | null = null;
let loaded: string | null = null;
/** The `load` request progress reports belong to. */
let loading: number | null = null;

function getEngine(): MLCEngine {
  engine ??= new MLCEngine({
    initProgressCallback(report: InitProgressReport) {
      if (loading !== null) {
        scope.postMessage({
          id: loading,
          type: 'progress',
          progress: report.progress,
          stage: stageOf(report.text),
        });
      }
    },
  });
  return engine;
}

function needsDownload(): Error {
  return Object.assign(new Error('The model is not all in the cache'), { name: NEEDS_DOWNLOAD });
}

/**
 * Runs `load` with the network shut: WebLLM fills its cache with
 * `Cache.add()` (and fetches a few files directly), so both refuse while it
 * runs. The page checked every file first; this is the guarantee that a
 * load nobody agreed to download never downloads.
 */
async function offline<T>(load: () => Promise<T>): Promise<T> {
  const add = Cache.prototype.add;
  const addAll = Cache.prototype.addAll;
  const networkFetch = scope.fetch;
  Cache.prototype.add = () => Promise.reject(needsDownload());
  Cache.prototype.addAll = () => Promise.reject(needsDownload());
  scope.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
    const local =
      url.origin === self.location.origin || url.protocol === 'data:' || url.protocol === 'blob:';
    return local ? networkFetch.call(self, input, init) : Promise.reject(needsDownload());
  };
  try {
    return await load();
  } finally {
    Cache.prototype.add = add;
    Cache.prototype.addAll = addAll;
    scope.fetch = networkFetch;
  }
}

async function handle(message: Exclude<ToWorker, { type: 'interrupt' }>) {
  switch (message.type) {
    case 'load': {
      const model = message.build.id;
      if (loaded !== model) {
        loading = message.id;
        try {
          const reload = () => getEngine().reload(model);
          await (message.offline ? offline(reload) : reload());
        } catch (error) {
          loaded = null;
          await engine?.unload().catch(() => undefined);
          throw error;
        } finally {
          loading = null;
        }
        loaded = model;
      }
      return null;
    }
    case 'chat': {
      if (engine === null || loaded === null) {
        throw new Error('No model is loaded');
      }
      const qwen3 = loaded.startsWith('Qwen3-');
      const reply = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: message.system },
          { role: 'user', content: message.prompt },
        ],
        max_tokens: message.maxTokens,
        ...(qwen3
          ? {
              // Qwen3's settings for answers without thinking, with its presence
              // penalty for quantized builds, against repetition loops.
              temperature: 0.7,
              top_p: 0.8,
              presence_penalty: 1.5,
              // A rewrite, not a chat: thinking only spends the context window.
              extra_body: { enable_thinking: false },
            }
          : { temperature: 0.3, top_p: 0.9 }),
      });
      const choice = reply.choices[0];
      const result: ChatResult = {
        text: choice?.message.content ?? '',
        finish: choice?.finish_reason ?? null,
      };
      return result;
    }
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'interrupt') {
    void engine?.interruptGenerate();
    return;
  }
  handle(message).then(
    (value) => scope.postMessage({ id: message.id, type: 'done', value }),
    (error: unknown) =>
      scope.postMessage({
        id: message.id,
        type: 'error',
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      }),
  );
});
