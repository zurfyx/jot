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
  type CacheState,
  unsupportedReason,
  webllmBuild,
  writeChoice,
  MODEL_IDS,
} from './models';
import { checkAvailability, languageModel } from './prompt-api';
import { cacheState, clearCache } from './webllm/cache';
import { webllmBackend, webllmEngine } from './webllm/client';

export type Resolved = { backend: AiBackend } | { backend: null; reason: string };

export interface AiModels {
  /** What this device can run, once probed. */
  device: ReadonlySignal<Device | null>;
  /** The person's choice in this browser, or null for the default. */
  chosen: ReadonlySignal<ModelId | null>;
  /** What Cache Storage holds of each WebLLM build this device uses. */
  cache: ReadonlySignal<ReadonlyMap<string, CacheState>>;
  /** Asks the browser what it can run (local; sends nothing). */
  probe(): Promise<Device>;
  choose(id: ModelId): void;
  /** The model Ask AI uses now, or why none can run. */
  resolve(): Promise<Resolved>;
  state(id: ModelId, device: Device): ModelState;
  /** Reads Cache Storage again for the setting's states (local; loads no WebLLM). */
  refreshCache(): Promise<void>;
  /** Removes a WebLLM model's files, whole or partial, from this browser. */
  remove(id: ModelId): Promise<void>;
}

function createAiModels(): AiModels {
  const device = signal<Device | null>(null);
  const chosen = signal<ModelId | null>(readChoice());
  const cache = signal<ReadonlyMap<string, CacheState>>(new Map());

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
    const build = webllmBuild(id, found);
    return build === null ? null : webllmBackend(MODELS[id], build);
  };

  const refreshCache = async () => {
    const found = device.peek() ?? (await probe());
    const next = new Map<string, CacheState>();
    for (const id of MODEL_IDS) {
      const build = webllmBuild(id, found);
      if (build !== null) {
        // A cancelled download's files may still be going.
        await webllmEngine().cleared(build.id);
        next.set(build.id, await cacheState(build));
      }
    }
    cache.value = next;
  };

  return {
    device,
    chosen,
    cache,
    probe,
    refreshCache,
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
      return modelState(id, found, { loaded: webllmEngine().loaded, cache: cache.peek() });
    },
    async remove(id) {
      const found = device.peek() ?? (await probe());
      const build = webllmBuild(id, found);
      if (build !== null) {
        if (webllmEngine().loaded === build.id) {
          webllmEngine().stop();
        }
        try {
          await clearCache(build);
        } finally {
          await refreshCache();
        }
      }
    },
  };
}

let shared: AiModels | null = null;

/** The page's AI model setting. */
export function aiModels(): AiModels {
  shared ??= createAiModels();
  return shared;
}
