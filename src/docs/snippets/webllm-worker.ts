/**
 * A WebLLM model in a module worker, so the page never loads WebLLM (about
 * 2 MB compressed) and typing stays smooth while the model writes. Start it
 * only from a click: `new Worker(new URL('./webllm-worker.ts', import.meta.url), { type: 'module' })`.
 */
import { hasModelInCache, MLCEngine } from '@mlc-ai/web-llm';

const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'; // about 300 MB, from Hugging Face
const scope = self as unknown as { postMessage(message: unknown): void };

const engine = new MLCEngine({
  initProgressCallback: ({ progress, text }) =>
    scope.postMessage({ type: 'progress', progress, text }),
});

type Request = { type: 'has' } | { type: 'load' } | { type: 'ask'; system: string; prompt: string };

addEventListener('message', async (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === 'has') {
    // Ask the person before a download: is the model already in this browser?
    scope.postMessage({ type: 'has', value: await hasModelInCache(MODEL) });
  } else if (request.type === 'load') {
    await engine.reload(MODEL); // downloads what the cache lacks, then compiles for WebGPU
    scope.postMessage({ type: 'loaded' });
  } else {
    const reply = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      max_tokens: 1024,
    });
    const choice = reply.choices[0];
    // `length`: the reply ran out of room; don't write half an answer.
    scope.postMessage({
      type: 'reply',
      text: choice?.message.content,
      finish: choice?.finish_reason,
    });
  }
});
