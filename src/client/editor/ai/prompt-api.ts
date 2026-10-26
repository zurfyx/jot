/**
 * Chrome's built-in Prompt API (`LanguageModel`, Gemini Nano on the device),
 * typed here because TypeScript's DOM library doesn't have it yet. Only what
 * jot uses, following Chrome's current shape:
 *
 *   await LanguageModel.availability(options)
 *     // 'unavailable' | 'downloadable' | 'downloading' | 'available'
 *   const model = await LanguageModel.create({ ...options, initialPrompts, monitor, signal });
 *     // monitor(m): m fires 'downloadprogress' with `loaded` from 0 to 1
 *   const reply = await model.prompt(text, { signal });
 *   model.destroy();
 *
 * `availability()` and `create()` take the same options: availability is per
 * configuration (languages, modalities), not absolute. Creating a model whose
 * availability is `downloadable` starts the download, which needs a user
 * activation: jot creates one only from the Ask button.
 */

export type ModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface ModelExpectation {
  type: 'text';
  languages?: string[];
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelOptions {
  expectedInputs?: ModelExpectation[];
  expectedOutputs?: ModelExpectation[];
}

export interface ModelCreateOptions extends ModelOptions {
  initialPrompts?: ModelMessage[];
  /** Receives an EventTarget that fires `downloadprogress` (`loaded`: 0 to 1). */
  monitor?: (monitor: EventTarget) => void;
  signal?: AbortSignal;
}

export interface ModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

export interface LanguageModelApi {
  availability(options?: ModelOptions): Promise<ModelAvailability>;
  create(options?: ModelCreateOptions): Promise<ModelSession>;
}

/** What jot asks of the model: English text in, English text out. */
export const MODEL_OPTIONS: ModelOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

/** The page's `LanguageModel`, or null where the browser has none. */
export function languageModel(): LanguageModelApi | null {
  const api = (globalThis as { LanguageModel?: unknown }).LanguageModel;
  if (
    (typeof api === 'function' || (typeof api === 'object' && api !== null)) &&
    typeof (api as Partial<LanguageModelApi>).availability === 'function' &&
    typeof (api as Partial<LanguageModelApi>).create === 'function'
  ) {
    return api as LanguageModelApi;
  }
  return null;
}

/** `missing`: the browser has no `LanguageModel` at all. */
export type AiAvailability = ModelAvailability | 'missing';

/** Asks the browser whether the model is there. Sends nothing anywhere; never throws. */
export async function checkAvailability(
  api: LanguageModelApi | null = languageModel(),
): Promise<AiAvailability> {
  if (api === null) {
    return 'missing';
  }
  try {
    const result = await api.availability(MODEL_OPTIONS);
    return result === 'available' || result === 'downloadable' || result === 'downloading'
      ? result
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** A download progress event's fraction, 0 to 1, or null when it carries none. */
export function progressOf(event: Event): number | null {
  const { loaded, total } = event as Partial<ProgressEvent>;
  if (typeof loaded !== 'number' || !Number.isFinite(loaded)) {
    return null;
  }
  // Chrome reports `loaded` from 0 to 1 (total 1); older builds sent bytes.
  const fraction = typeof total === 'number' && total > 1 ? loaded / total : loaded;
  return Math.min(1, Math.max(0, fraction));
}
