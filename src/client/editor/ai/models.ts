/**
 * The models Ask AI can run (D26), and which one a browser gets by default.
 * Everything here is pure: the probes that fill a `Device` live in
 * `device.ts`, so the choice is unit tested without a browser.
 *
 *   chrome  Chrome's built-in Gemini Nano, through the Prompt API (D21)
 *   small   Qwen2.5 0.5B Instruct in WebLLM on WebGPU: phones and low-memory devices
 *   large   Qwen3 1.7B in WebLLM on WebGPU: laptops and desktops
 */
import type { AiAvailability } from './prompt-api';

export type ModelId = 'chrome' | 'small' | 'large';

export const MODEL_IDS: readonly ModelId[] = ['chrome', 'small', 'large'];

/** A WebLLM prebuilt model, in the two builds WebGPU devices need. */
export interface WebLLMModel {
  /** With 16-bit floats in the shaders: needs the adapter's `shader-f16`. */
  f16: string;
  /** 32-bit floats: any WebGPU adapter, a little more GPU memory. */
  f32: string;
  /** Tokens, prompt and reply together (WebLLM's prebuilt setting). */
  contextWindow: number;
}

export interface ModelInfo {
  id: ModelId;
  /** What the setting calls it. */
  label: string;
  /** The model itself, in the field ("Downloading Qwen2.5 0.5B"). */
  name: string;
  /** Where it runs, in a few words. */
  where: string;
  /** What this device downloads for it, or null when the browser manages it. */
  download: { bytes: number; text: string } | null;
  webllm: WebLLMModel | null;
}

export const MODELS: Readonly<Record<ModelId, ModelInfo>> = {
  chrome: {
    id: 'chrome',
    label: 'Chrome built-in',
    name: 'Gemini Nano',
    where: 'Chrome and Edge on desktop',
    download: null,
    webllm: null,
  },
  small: {
    id: 'small',
    label: 'Small',
    name: 'Qwen2.5 0.5B',
    where: 'In the browser, best on phones',
    // The Hugging Face repo (weights, tokenizer, config) plus the WebGPU library.
    download: { bytes: 295_000_000, text: '300 MB' },
    webllm: {
      f16: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      f32: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
      contextWindow: 4096,
    },
  },
  large: {
    id: 'large',
    label: 'Larger',
    name: 'Qwen3 1.7B',
    where: 'In the browser, best on laptops',
    download: { bytes: 991_000_000, text: '990 MB' },
    webllm: { f16: 'Qwen3-1.7B-q4f16_1-MLC', f32: 'Qwen3-1.7B-q4f32_1-MLC', contextWindow: 4096 },
  },
};

/**
 * WebGPU on this device: `none` (no `navigator.gpu`), `no-adapter` (WebGPU,
 * but no usable adapter: a blocked or missing GPU), or an adapter with or
 * without 16-bit shader floats.
 */
export type Gpu = 'none' | 'no-adapter' | 'f16' | 'f32';

export interface Device {
  /** Chrome's built-in model, as `LanguageModel.availability()` reports it. */
  prompt: AiAvailability;
  gpu: Gpu;
  /** A phone, a tablet, or little memory: the small model fits better. */
  small: boolean;
}

/** What the browser says about its device, for `isSmallDevice`. */
export interface DeviceHints {
  /** `navigator.userAgentData.mobile` (Chromium only). */
  mobile?: boolean;
  /** `navigator.deviceMemory`, in GB, rounded down and capped at 8 (Chromium only). */
  memory?: number;
  /** `screen.width` and `screen.height`, in CSS pixels. */
  screen: { width: number; height: number };
  userAgent: string;
  maxTouchPoints: number;
}

/**
 * Phones, tablets and devices with 4 GB of memory or less get the small
 * model. Safari has neither UA-CH nor `deviceMemory`, so the user agent and
 * the screen decide there; an iPad (which says "Macintosh", with touch) counts
 * as small too, for iOS's tight per-tab memory.
 */
export function isSmallDevice(hints: DeviceHints): boolean {
  if (hints.mobile === true) {
    return true;
  }
  const ua = hints.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) {
    return true;
  }
  if (/Macintosh/.test(ua) && hints.maxTouchPoints > 1) {
    return true;
  }
  if (hints.memory !== undefined && hints.memory > 0 && hints.memory <= 4) {
    return true;
  }
  return Math.min(hints.screen.width, hints.screen.height) < 600;
}

function hasWebGPU(device: Device): boolean {
  return device.gpu === 'f16' || device.gpu === 'f32';
}

/** Whether `id` can run on `device` at all. */
export function canRun(id: ModelId, device: Device): boolean {
  if (id === 'chrome') {
    return (
      device.prompt === 'available' ||
      device.prompt === 'downloadable' ||
      device.prompt === 'downloading'
    );
  }
  return hasWebGPU(device);
}

/**
 * The model Ask AI uses when the person hasn't chosen one: Chrome's when it
 * is ready; otherwise WebLLM, small or larger by the device; otherwise
 * Chrome's if Chrome can still download it; otherwise none.
 */
export function defaultModel(device: Device): ModelId | null {
  if (device.prompt === 'available') {
    return 'chrome';
  }
  if (hasWebGPU(device)) {
    return device.small ? 'small' : 'large';
  }
  if (canRun('chrome', device)) {
    return 'chrome';
  }
  return null;
}

/** The person's choice where it can run here, else the default. */
export function activeModel(device: Device, chosen: ModelId | null): ModelId | null {
  return chosen !== null && canRun(chosen, device) ? chosen : defaultModel(device);
}

/** The WebLLM build `id` uses on `device`, or null for Chrome's model or no WebGPU. */
export function webllmId(id: ModelId, device: Device): string | null {
  const model = MODELS[id].webllm;
  if (model === null || !hasWebGPU(device)) {
    return null;
  }
  return device.gpu === 'f16' ? model.f16 : model.f32;
}

/** Why no model can run, when `defaultModel` is null. */
export function unsupportedReason(device: Device): string {
  return device.gpu === 'no-adapter'
    ? "Ask AI runs a model on this device, and this browser can't: WebGPU found no usable graphics adapter, and there is no built-in AI. Try a recent Chrome, Edge or Safari on another device."
    : "Ask AI runs a model on this device, and this browser can't: it has no WebGPU and no built-in AI. Try a recent Chrome, Edge or Safari.";
}

/**
 * The longest passage, in characters, a WebLLM model takes: the passage and
 * its rewrite share the context window with the system prompt, at a
 * conservative three characters a token.
 */
export function webllmMaxPassage(contextWindow: number): number {
  const overhead = 400;
  return Math.floor(((contextWindow - overhead) / 2) * 3);
}

const CHOICE_KEY = 'jot:ai-model';

export function isModelId(value: unknown): value is ModelId {
  return value === 'chrome' || value === 'small' || value === 'large';
}

/** The person's choice in this browser, or null for the default. */
export function readChoice(): ModelId | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return isModelId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeChoice(id: ModelId): void {
  try {
    localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // Storage is off: the choice lasts for this page.
  }
}

/** A model's state on this device, for the AI model setting. */
export type ModelState = 'ready' | 'needs-download' | 'downloaded' | 'unsupported';

export const STATE_TEXT: Readonly<Record<ModelState, string>> = {
  ready: 'Ready',
  'needs-download': 'Needs download',
  downloaded: 'Downloaded',
  unsupported: 'Not supported on this device',
};

/**
 * `ready`: runs at once (Chrome's model is there, or a WebLLM model is loaded
 * in this tab); `downloaded`: a WebLLM model in this browser's cache, to load
 * on the next Ask; `needs-download`: downloads on the first Ask.
 */
export function modelState(
  id: ModelId,
  device: Device,
  here: { loaded: string | null; downloaded: ReadonlySet<string> },
): ModelState {
  if (!canRun(id, device)) {
    return 'unsupported';
  }
  if (id === 'chrome') {
    return device.prompt === 'available' ? 'ready' : 'needs-download';
  }
  const build = webllmId(id, device)!;
  if (here.loaded === build) {
    return 'ready';
  }
  return here.downloaded.has(build) ? 'downloaded' : 'needs-download';
}
