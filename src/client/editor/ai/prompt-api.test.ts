import { afterEach, describe, expect, it } from 'vitest';

import { checkAvailability, languageModel, MODEL_OPTIONS, progressOf } from './prompt-api';

const global = globalThis as { LanguageModel?: unknown };

afterEach(() => {
  delete global.LanguageModel;
});

describe('the Prompt API', () => {
  it('is found only with availability() and create()', () => {
    expect(languageModel()).toBeNull();
    global.LanguageModel = { availability: () => undefined };
    expect(languageModel()).toBeNull();
    const api = { availability: () => undefined, create: () => undefined };
    global.LanguageModel = api;
    expect(languageModel()).toBe(api);
  });

  it('reports availability with the options create() gets, and never throws', async () => {
    expect(await checkAvailability(null)).toBe('missing');
    let asked: unknown = null;
    const api = (result: () => Promise<string>) => ({
      availability(options: unknown) {
        asked = options;
        return result();
      },
      create: () => Promise.reject(new Error('not here')),
    });
    expect(await checkAvailability(api(() => Promise.resolve('downloadable')) as never)).toBe(
      'downloadable',
    );
    expect(asked).toBe(MODEL_OPTIONS);
    expect(await checkAvailability(api(() => Promise.resolve('readily')) as never)).toBe(
      'unavailable',
    );
    expect(await checkAvailability(api(() => Promise.reject(new Error('x'))) as never)).toBe(
      'unavailable',
    );
  });

  it('reads download progress as a fraction', () => {
    const event = (fields: object) => Object.assign(new Event('downloadprogress'), fields);
    expect(progressOf(event({ loaded: 0.25, total: 1 }))).toBe(0.25);
    expect(progressOf(event({ loaded: 0.5 }))).toBe(0.5);
    expect(progressOf(event({ loaded: 50, total: 200 }))).toBe(0.25);
    expect(progressOf(event({ loaded: 3 }))).toBe(1);
    expect(progressOf(event({}))).toBeNull();
  });
});
