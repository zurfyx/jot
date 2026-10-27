/**
 * The AI model setting (D26), one per page: the person's choice (kept in
 * localStorage), what this device can run, and each model's backend. Ask AI
 * resolves the model it uses here on every Ask, so a change in the setting
 * applies to the next request.
 */
import { type ReadonlySignal, signal } from '@lexical/extension';

import { type AiBackend, promptApiBackend } from './backend';
import { deviceHints, probeGpu } from './device';
import {
  activeModel,
  type Device,
  isSmallDevice,
  type ModelId,
  MODELS,
  modelState,
  type ModelState,
  readChoice,
  unsupportedReason,
  webllmId,
  writeChoice,
} from './models';
import { checkAvailability, languageModel } from './prompt-api';
import { deleteModel, downloadedModels, webllmBackend, webllmEngine } from './webllm/client';

export type Resolved = { backend: AiBackend } | { backend: null; reason: string };

export interface AiModels {
  /** What this device can run, once probed. */
  device: ReadonlySignal<Device | null>;
  /** The person's choice in this browser, or null for the default. */
  chosen: ReadonlySignal<ModelId | null>;
  /** Bumps when a model downloads or is deleted, for the setting's statuses. */
  revision: ReadonlySignal<number>;
  /** Asks the browser what it can run (local; sends nothing). */
  probe(): Promise<Device>;
  choose(id: ModelId): void;
  /** The model Ask AI uses now, or why none can run. */
  resolve(): Promise<Resolved>;
  state(id: ModelId, device: Device): ModelState;
  /** Removes a downloaded WebLLM model from this browser. */
  remove(id: ModelId): Promise<void>;
  /** A model finished loading (its status turns Ready). */
  touched(): void;
}

function createAiModels(): AiModels {
  const device = signal<Device | null>(null);
  const chosen = signal<ModelId | null>(readChoice());
  const revision = signal(0);

  const probe = async (): Promise<Device> => {
    const [prompt, gpu] = await Promise.all([checkAvailability(languageModel()), probeGpu()]);
    const found: Device = { prompt, gpu, small: isSmallDevice(deviceHints()) };
    device.value = found;
    return found;
  };

  const backendFor = (id: ModelId, found: Device): AiBackend | null => {
    if (id === 'chrome') {
      const api = languageModel();
      return api === null ? null : promptApiBackend(api);
    }
    const build = webllmId(id, found);
    return build === null ? null : webllmBackend(MODELS[id], build);
  };

  return {
    device,
    chosen,
    revision,
    probe,
    choose(id) {
      chosen.value = id;
      writeChoice(id);
    },
    async resolve() {
      const found = await probe();
      const id = activeModel(found, chosen.peek());
      const backend = id === null ? null : backendFor(id, found);
      return backend === null ? { backend: null, reason: unsupportedReason(found) } : { backend };
    },
    state(id, found) {
      return modelState(id, found, {
        loaded: webllmEngine().loaded,
        downloaded: downloadedModels(),
      });
    },
    async remove(id) {
      const found = device.peek() ?? (await probe());
      const build = webllmId(id, found);
      if (build !== null) {
        try {
          await deleteModel(build);
        } finally {
          revision.value += 1;
        }
      }
    },
    touched() {
      revision.value += 1;
    },
  };
}

let shared: AiModels | null = null;

/** The page's AI model setting. */
export function aiModels(): AiModels {
  shared ??= createAiModels();
  return shared;
}
