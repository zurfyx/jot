import { describe, expect, it } from 'vitest';

import { MODELS } from '../models';
import { type CacheStorageLike, cacheState, clearCache, repoBase } from './cache';
import { stageOf } from './protocol';

const SMALL = MODELS.small.webllm!.f16;
const LARGE = MODELS.large.webllm!.f16;
const base = repoBase(SMALL.url);

/** Cache Storage in memory, with WebLLM's scopes and URL keys. */
function fakeStorage() {
  const scopes = new Map<string, Map<string, unknown>>();
  const store: CacheStorageLike = {
    has: (name) => Promise.resolve(scopes.has(name)),
    open: (name) => {
      const entries = scopes.get(name) ?? new Map<string, unknown>();
      scopes.set(name, entries);
      return Promise.resolve({
        match: (url: string) =>
          Promise.resolve(
            entries.has(url) ? { json: () => Promise.resolve(entries.get(url)) } : undefined,
          ),
        keys: () => Promise.resolve([...entries.keys()].map((url) => ({ url }))),
        delete: (url: string) => Promise.resolve(entries.delete(url)),
      });
    },
  };
  const put = (scope: string, url: string, body: unknown = 'bytes') => {
    const entries = scopes.get(scope) ?? new Map<string, unknown>();
    scopes.set(scope, entries);
    entries.set(url, body);
  };
  /** Every file WebLLM stores for a build. */
  const fill = (build = SMALL) => {
    const at = repoBase(build.url);
    put('webllm/model', `${at}tensor-cache.json`, {
      records: [{ dataPath: 'params_shard_0.bin' }, { dataPath: 'params_shard_1.bin' }],
    });
    put('webllm/model', `${at}params_shard_0.bin`);
    put('webllm/model', `${at}params_shard_1.bin`);
    put('webllm/model', `${at}tokenizer.json`);
    put('webllm/config', `${at}mlc-chat-config.json`, {
      tokenizer_files: ['tokenizer.json', 'vocab.json'],
    });
    put('webllm/wasm', build.lib);
  };
  const remove = (scope: string, url: string) => scopes.get(scope)?.delete(url);
  const urls = () => [...scopes.values()].flatMap((entries) => [...entries.keys()]);
  return { store, put, fill, remove, urls };
}

describe("WebLLM's cache, read from the page", () => {
  it('resolves files against the repo the way WebLLM does', () => {
    expect(repoBase('https://huggingface.co/mlc-ai/X')).toBe(
      'https://huggingface.co/mlc-ai/X/resolve/main/',
    );
    expect(repoBase('https://huggingface.co/mlc-ai/X/resolve/v2/')).toBe(
      'https://huggingface.co/mlc-ai/X/resolve/v2/',
    );
  });

  it('is complete only with the weights, the tokenizer, the config and the WebGPU library', async () => {
    const files = fakeStorage();
    expect(await cacheState(SMALL, files.store)).toBe('none');
    files.fill();
    expect(await cacheState(SMALL, files.store)).toBe('complete');
    for (const [scope, url] of [
      ['webllm/wasm', SMALL.lib],
      ['webllm/model', `${base}tokenizer.json`],
      ['webllm/config', `${base}mlc-chat-config.json`],
      ['webllm/model', `${base}params_shard_1.bin`],
      ['webllm/model', `${base}tensor-cache.json`],
    ] as const) {
      const missing = fakeStorage();
      missing.fill();
      missing.remove(scope, url);
      expect(await cacheState(SMALL, missing.store), url).toBe('partial');
    }
  });

  it("doesn't count another model's files, and says none without Cache Storage", async () => {
    const files = fakeStorage();
    files.fill(LARGE);
    expect(await cacheState(SMALL, files.store)).toBe('none');
    expect(await cacheState(LARGE, files.store)).toBe('complete');
    expect(await cacheState(SMALL, null)).toBe('none');
  });

  it("clears every file of a build, whole or partial, and nothing of another's", async () => {
    const files = fakeStorage();
    files.fill(SMALL);
    files.fill(LARGE);
    files.remove('webllm/model', `${base}params_shard_1.bin`);
    await clearCache(SMALL, files.store);
    expect(await cacheState(SMALL, files.store)).toBe('none');
    expect(await cacheState(LARGE, files.store)).toBe('complete');
    expect(files.urls().some((url) => url.startsWith(base) || url === SMALL.lib)).toBe(false);
  });
});

describe("WebLLM's progress", () => {
  it('reads the stage from the report texts WebLLM writes', () => {
    expect(stageOf('Start to fetch params')).toBe('start');
    expect(
      stageOf('Fetching param cache[3/12]: 120MB fetched. 40% completed, 3 secs elapsed.'),
    ).toBe('fetch');
    expect(
      stageOf('Loading model from cache[3/12]: 120MB loaded. 40% completed, 1 secs elapsed.'),
    ).toBe('load');
    expect(stageOf('Finish loading on WebGPU - apple')).toBe('finish');
  });
});
