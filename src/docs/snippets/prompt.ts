/** Chrome's built-in model (the Prompt API). Not in TypeScript's DOM types yet. */
interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  measureInputUsage?(input: string, options?: { signal?: AbortSignal }): Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
  destroy(): void;
}
type Expectation = { type: 'text'; languages: string[] }[];
interface LanguageModelOptions {
  expectedInputs?: Expectation;
  expectedOutputs?: Expectation;
}
interface LanguageModelStatic {
  availability(
    options?: LanguageModelOptions,
  ): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(
    options?: LanguageModelOptions & {
      initialPrompts?: { role: 'system'; content: string }[];
      monitor?: (m: EventTarget) => void;
      signal?: AbortSignal;
    },
  ): Promise<LanguageModelSession>;
}
declare const LanguageModel: LanguageModelStatic | undefined;

// Availability is per configuration: ask with the same options you'll create with.
const ENGLISH = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

/** Local: asks the browser whether the model is there, and sends nothing. */
export async function modelStatus() {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  return LanguageModel.availability(ENGLISH);
}

/** Only from a click (Ask): creating a 'downloadable' model starts its download. */
export async function ask(system: string, prompt: string, signal: AbortSignal) {
  const model = await LanguageModel!.create({
    ...ENGLISH,
    initialPrompts: [{ role: 'system', content: system }],
    signal,
    monitor: (m) =>
      m.addEventListener('downloadprogress', (e) => {
        console.log(`Downloading: ${Math.round((e as ProgressEvent).loaded * 100)}%`);
      }),
  });
  try {
    // Does the passage fit the context window? (Where the browser can tell.)
    if (model.measureInputUsage !== undefined && model.inputQuota !== undefined) {
      const usage = await model.measureInputUsage(prompt, { signal });
      if (usage > model.inputQuota - (model.inputUsage ?? 0)) return null;
    }
    return await model.prompt(prompt, { signal });
  } finally {
    model.destroy();
  }
}
