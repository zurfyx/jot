/**
 * jot's WebLLM worker: runs the model off the page's main thread, so typing
 * stays responsive while it downloads, compiles and writes. The page talks
 * to it through protocol.ts; this is the only file that imports WebLLM.
 *
 * Models and their WebGPU libraries come from WebLLM's default hosts
 * (Hugging Face and raw.githubusercontent.com), and WebLLM keeps them in the
 * browser's Cache Storage, where `has` and `delete` look.
 */
import {
  deleteModelAllInfoInCache,
  hasModelInCache,
  type InitProgressReport,
  MLCEngine,
} from '@mlc-ai/web-llm';

import type { ChatResult, FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
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
          // "Fetching param cache[3/12]…", then "Loading model from cache[3/12]…".
          loading: /^Loading/i.test(report.text),
          text: report.text,
        });
      }
    },
  });
  return engine;
}

async function handle(message: Exclude<ToWorker, { type: 'interrupt' }>) {
  switch (message.type) {
    case 'has':
      return hasModelInCache(message.model);
    case 'delete':
      if (loaded === message.model) {
        await engine?.unload();
        loaded = null;
      }
      await deleteModelAllInfoInCache(message.model);
      return null;
    case 'load': {
      if (loaded !== message.model) {
        loading = message.id;
        try {
          await getEngine().reload(message.model);
        } finally {
          loading = null;
        }
        loaded = message.model;
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
