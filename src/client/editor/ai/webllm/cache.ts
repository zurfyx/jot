/**
 * What WebLLM keeps in Cache Storage for a build, read and cleared from the
 * page without loading WebLLM (D26). WebLLM's default backend stores, per
 * origin:
 *
 *   webllm/model   <repo>/resolve/main/tensor-cache.json, every shard it
 *                  lists, and the tokenizer file the config names
 *   webllm/config  <repo>/resolve/main/mlc-chat-config.json
 *   webllm/wasm    the build's WebGPU library
 *
 * A build is `complete` only with every one of them: anything less would
 * fetch from the network on load, which needs the person's consent.
 */
import type { CacheState, WebLLMBuild } from '../models';

const MODEL_SCOPE = 'webllm/model';
const CONFIG_SCOPE = 'webllm/config';
const WASM_SCOPE = 'webllm/wasm';

/** The repo URL as WebLLM resolves files against it. */
export function repoBase(url: string): string {
  let base = url.endsWith('/') ? url : `${url}/`;
  if (!/.+\/resolve\/.+\//.test(base)) {
    base += 'resolve/main/';
  }
  return base;
}

/** What jot needs of Cache Storage; tests stand in for it. */
export interface CacheStorageLike {
  has(name: string): Promise<boolean>;
  open(name: string): Promise<{
    match(url: string): Promise<{ json(): Promise<unknown> } | undefined>;
    keys(): Promise<readonly { url: string }[]>;
    delete(url: string): Promise<boolean>;
  }>;
}

function storage(): CacheStorageLike | null {
  return typeof caches === 'undefined' ? null : (caches as unknown as CacheStorageLike);
}

async function scope(store: CacheStorageLike, name: string) {
  return (await store.has(name)) ? store.open(name) : null;
}

function records(manifest: unknown): string[] | null {
  const list = (manifest as { records?: unknown } | null)?.records;
  if (!Array.isArray(list)) {
    return null;
  }
  const paths = list.map((entry) => (entry as { dataPath?: unknown } | null)?.dataPath);
  return paths.every((path) => typeof path === 'string') ? (paths as string[]) : null;
}

function tokenizerFile(config: unknown): string | null {
  const files = (config as { tokenizer_files?: unknown } | null)?.tokenizer_files;
  if (!Array.isArray(files)) {
    return null;
  }
  return files.includes('tokenizer.json')
    ? 'tokenizer.json'
    : files.includes('tokenizer.model')
      ? 'tokenizer.model'
      : null;
}

/** Every file of `build` in the cache, some of them, or none. Never throws. */
export async function cacheState(
  build: WebLLMBuild,
  store: CacheStorageLike | null = storage(),
): Promise<CacheState> {
  if (store === null) {
    return 'none';
  }
  try {
    const base = repoBase(build.url);
    const [models, configs, wasms] = await Promise.all([
      scope(store, MODEL_SCOPE),
      scope(store, CONFIG_SCOPE),
      scope(store, WASM_SCOPE),
    ]);
    const modelKeys = models === null ? [] : (await models.keys()).map((key) => key.url);
    const configKeys = configs === null ? [] : (await configs.keys()).map((key) => key.url);
    const hasWasm = wasms !== null && (await wasms.match(build.lib)) !== undefined;
    const anything = hasWasm || [...modelKeys, ...configKeys].some((url) => url.startsWith(base));
    if (!anything) {
      return 'none';
    }
    const complete = async (): Promise<boolean> => {
      if (models === null || configs === null || !hasWasm) {
        return false;
      }
      const manifest = await models.match(new URL('tensor-cache.json', base).href);
      const config = await configs.match(new URL('mlc-chat-config.json', base).href);
      if (manifest === undefined || config === undefined) {
        return false;
      }
      const shards = records(await manifest.json());
      const tokenizer = tokenizerFile(await config.json());
      if (shards === null || tokenizer === null) {
        return false;
      }
      const have = new Set(modelKeys);
      return [...shards, tokenizer].every((path) => have.has(new URL(path, base).href));
    };
    return (await complete()) ? 'complete' : 'partial';
  } catch {
    return 'none';
  }
}

/** Removes every file of `build` from the cache, whole or partial. */
export async function clearCache(
  build: WebLLMBuild,
  store: CacheStorageLike | null = storage(),
): Promise<void> {
  if (store === null) {
    return;
  }
  const base = repoBase(build.url);
  for (const name of [MODEL_SCOPE, CONFIG_SCOPE]) {
    const cache = await scope(store, name);
    if (cache !== null) {
      for (const key of await cache.keys()) {
        if (key.url.startsWith(base)) {
          await cache.delete(key.url);
        }
      }
    }
  }
  const wasms = await scope(store, WASM_SCOPE);
  await wasms?.delete(build.lib);
}
