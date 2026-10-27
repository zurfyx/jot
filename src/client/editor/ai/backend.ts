/**
 * One shape for every model Ask AI runs (D26): Chrome's Prompt API and the
 * WebLLM models both become an `AiBackend`, so the controller treats them
 * alike. A backend says whether its model is here, and opens a session on
 * it; opening may download it, which only ever happens from Ask.
 */
import type { ModelId } from './models';
import {
  type AiAvailability,
  checkAvailability,
  type LanguageModelApi,
  MODEL_OPTIONS,
  progressOf,
} from './prompt-api';

/** A model, ready for prompts. */
export interface AiSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  /** How much of the context window `input` would take, where the model can tell. */
  measureInputUsage?(input: string, options?: { signal?: AbortSignal }): Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
  destroy(): void;
}

export interface OpenOptions {
  system: string;
  signal: AbortSignal;
  /**
   * 0 to 1, or null when the model can't say. `loading`: the files are here
   * and the model is loading from them (its progress starts again).
   */
  onProgress(progress: number | null, loading?: boolean): void;
  /** The person agreed to download the model (WebLLM asks first; Chrome doesn't). */
  consented: boolean;
}

export interface AiBackend {
  id: ModelId;
  /** The model's name, for the field ("Qwen2.5 0.5B"). */
  name: string;
  /**
   * A download the person must agree to before it starts, or null when the
   * browser manages the model itself (Chrome).
   */
  consent: { bytes: number; text: string } | null;
  /** The longest passage, in characters, beyond the shared ceiling. */
  maxPassage?: number;
  /** Local: is the model here? Never downloads. */
  availability(): Promise<AiAvailability>;
  /**
   * The model, ready: downloads it first if needed (with the person's
   * consent where `consent` is set). Rejects with `ModelError('consent')`
   * when the model turns out not to be here and nobody agreed yet.
   */
  open(options: OpenOptions): Promise<AiSession>;
}

export type ModelErrorReason =
  /** The model isn't here and the person hasn't agreed to download it. */
  | 'consent'
  /** The prompt doesn't fit the context window. */
  | 'too-long'
  /** The reply ran out of room before it ended. */
  | 'cut-off'
  /** The model couldn't load (network, GPU memory). */
  | 'load';

export class ModelError extends Error {
  constructor(
    readonly reason: ModelErrorReason,
    message: string = reason,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** Chrome's built-in model (D21) as a backend. */
export function promptApiBackend(api: LanguageModelApi): AiBackend {
  return {
    id: 'chrome',
    name: 'Gemini Nano',
    consent: null,
    availability: () => checkAvailability(api),
    open({ system, signal, onProgress }) {
      return api.create({
        ...MODEL_OPTIONS,
        initialPrompts: [{ role: 'system', content: system }],
        signal,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => onProgress(progressOf(event)));
        },
      });
    },
  };
}
