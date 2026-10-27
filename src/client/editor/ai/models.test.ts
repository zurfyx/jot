import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeModel,
  canRun,
  defaultModel,
  type Device,
  type DeviceHints,
  isSmallDevice,
  MODELS,
  modelState,
  readChoice,
  unsupportedReason,
  webllmId,
  webllmMaxPassage,
  writeChoice,
} from './models';

const desktop: DeviceHints = {
  mobile: false,
  memory: 8,
  screen: { width: 1512, height: 982 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0',
  maxTouchPoints: 0,
};

const device = (overrides: Partial<Device> = {}): Device => ({
  prompt: 'missing',
  gpu: 'f16',
  small: false,
  ...overrides,
});

describe('which devices count as small', () => {
  it('takes phones by their UA-CH hint or user agent', () => {
    expect(isSmallDevice(desktop)).toBe(false);
    expect(isSmallDevice({ ...desktop, mobile: true })).toBe(true);
    expect(
      isSmallDevice({
        ...desktop,
        mobile: undefined,
        memory: undefined,
        screen: { width: 390, height: 844 },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isSmallDevice({
        ...desktop,
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0 Mobile Safari/537.36',
      }),
    ).toBe(true);
  });

  it('takes an iPad, which says Macintosh but has touch', () => {
    expect(
      isSmallDevice({
        ...desktop,
        mobile: undefined,
        memory: undefined,
        screen: { width: 1024, height: 1366 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari',
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it('takes little memory or a small screen', () => {
    expect(isSmallDevice({ ...desktop, memory: 4 })).toBe(true);
    expect(isSmallDevice({ ...desktop, memory: 2 })).toBe(true);
    expect(isSmallDevice({ ...desktop, memory: 8 })).toBe(false);
    expect(isSmallDevice({ ...desktop, screen: { width: 540, height: 960 } })).toBe(true);
  });
});

describe('the default model', () => {
  it("is Chrome's when it is ready, whatever else the device has", () => {
    expect(defaultModel(device({ prompt: 'available' }))).toBe('chrome');
    expect(defaultModel(device({ prompt: 'available', small: true }))).toBe('chrome');
  });

  it('is WebLLM otherwise: small on phones, larger on desktops', () => {
    expect(defaultModel(device({ prompt: 'missing', small: true }))).toBe('small');
    expect(defaultModel(device({ prompt: 'missing', small: false }))).toBe('large');
    expect(defaultModel(device({ prompt: 'unavailable', gpu: 'f32' }))).toBe('large');
    // Chrome could download its model, but WebGPU runs one with no wait on Chrome.
    expect(defaultModel(device({ prompt: 'downloadable' }))).toBe('large');
  });

  it("falls back to Chrome's download without WebGPU, and to none without either", () => {
    expect(defaultModel(device({ prompt: 'downloadable', gpu: 'none' }))).toBe('chrome');
    expect(defaultModel(device({ prompt: 'downloading', gpu: 'no-adapter' }))).toBe('chrome');
    expect(defaultModel(device({ prompt: 'missing', gpu: 'none' }))).toBeNull();
    expect(defaultModel(device({ prompt: 'unavailable', gpu: 'no-adapter' }))).toBeNull();
  });

  it('gives way to the choice, where the choice can run', () => {
    const phone = device({ prompt: 'missing', small: true });
    expect(activeModel(phone, null)).toBe('small');
    expect(activeModel(phone, 'large')).toBe('large');
    // Chrome's model can't run on this phone: the default stands.
    expect(activeModel(phone, 'chrome')).toBe('small');
    expect(activeModel(device({ prompt: 'available', gpu: 'none' }), 'small')).toBe('chrome');
  });

  it('says why nothing runs', () => {
    expect(unsupportedReason(device({ gpu: 'none' }))).toContain('no WebGPU and no built-in AI');
    expect(unsupportedReason(device({ gpu: 'no-adapter' }))).toContain(
      'WebGPU found no usable graphics adapter',
    );
  });
});

describe('the models', () => {
  it('picks the WebLLM build the adapter can run', () => {
    expect(webllmId('small', device({ gpu: 'f16' }))).toBe('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
    expect(webllmId('small', device({ gpu: 'f32' }))).toBe('Qwen2.5-0.5B-Instruct-q4f32_1-MLC');
    expect(webllmId('large', device({ gpu: 'f16' }))).toBe('Qwen3-1.7B-q4f16_1-MLC');
    expect(webllmId('large', device({ gpu: 'none' }))).toBeNull();
    expect(webllmId('chrome', device())).toBeNull();
  });

  it('can run only where its runtime is', () => {
    expect(canRun('chrome', device({ prompt: 'downloadable' }))).toBe(true);
    expect(canRun('chrome', device({ prompt: 'unavailable' }))).toBe(false);
    expect(canRun('small', device({ gpu: 'no-adapter' }))).toBe(false);
  });

  it('says each one is ready, downloaded, to download, or not for this device', () => {
    const none = { loaded: null, downloaded: new Set<string>() };
    expect(modelState('chrome', device({ prompt: 'available' }), none)).toBe('ready');
    expect(modelState('chrome', device({ prompt: 'downloadable' }), none)).toBe('needs-download');
    expect(modelState('chrome', device({ prompt: 'missing' }), none)).toBe('unsupported');
    expect(modelState('small', device(), none)).toBe('needs-download');
    expect(
      modelState('small', device(), {
        loaded: null,
        downloaded: new Set(['Qwen2.5-0.5B-Instruct-q4f16_1-MLC']),
      }),
    ).toBe('downloaded');
    expect(
      modelState('small', device(), {
        loaded: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        downloaded: new Set(),
      }),
    ).toBe('ready');
    // The f16 build downloaded doesn't count for an adapter without f16.
    expect(
      modelState('small', device({ gpu: 'f32' }), {
        loaded: null,
        downloaded: new Set(['Qwen2.5-0.5B-Instruct-q4f16_1-MLC']),
      }),
    ).toBe('needs-download');
    expect(modelState('large', device({ gpu: 'none' }), none)).toBe('unsupported');
  });

  it('keeps a passage and its rewrite inside the context window', () => {
    const max = webllmMaxPassage(MODELS.small.webllm!.contextWindow);
    expect(max).toBe(5544);
    // Twice the passage, at three characters a token, plus the overhead, fits.
    expect((2 * max) / 3 + 400).toBeLessThanOrEqual(4096);
  });
});

describe('the choice', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is kept in this browser, and ignores what it does not know', () => {
    expect(readChoice()).toBeNull();
    writeChoice('small');
    expect(readChoice()).toBe('small');
    localStorage.setItem('jot:ai-model', 'huge');
    expect(readChoice()).toBeNull();
  });
});
