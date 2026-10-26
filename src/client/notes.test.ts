import { describe, expect, it } from 'vitest';

import { isNoteId } from '../shared/ids';
import {
  claimLegacyDraft,
  LEGACY_DRAFT_KEY,
  LEGACY_DRAFT_LOCK,
  legacyPendingKey,
  newNotePath,
} from './notes';

/** A Storage over a Map; `room` limits how many items it holds, like a quota. */
function memoryStorage(room = Infinity): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => {
      if (!map.has(key) && map.size >= room) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      map.set(key, value);
    },
  };
}

/** Web Locks for one thread: requests run one at a time, in order. */
function memoryLocks(onRequest?: (name: string) => void) {
  let queue = Promise.resolve<unknown>(undefined);
  const requested: string[] = [];
  return {
    requested,
    request: ((name: string, callback: () => unknown) => {
      requested.push(name);
      onRequest?.(name);
      const run = queue.then(callback);
      queue = run.catch(() => undefined);
      return run;
    }) as unknown as LockManager['request'],
  };
}

const ID = 'k3Jd9xQ2aaaaaaaaaaaaaA';
const OTHER = 'k3Jd9xQ2bbbbbbbbbbbbbA';

describe('claimLegacyDraft', () => {
  it("moves an earlier version's draft to the new note's pending copy, under the lock", async () => {
    const storage = memoryStorage();
    const locks = memoryLocks();
    storage.setItem(LEGACY_DRAFT_KEY, '{"id":"d","state":"AA=="}');
    expect(await claimLegacyDraft(ID, { storage, locks })).toBe(true);
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(storage.getItem(legacyPendingKey(ID))).toBe('{"id":"d","state":"AA=="}');
    expect(locks.requested).toEqual([LEGACY_DRAFT_LOCK]);
  });

  it('takes no lock and changes nothing without a draft', async () => {
    const storage = memoryStorage();
    const locks = memoryLocks();
    expect(await claimLegacyDraft(ID, { storage, locks })).toBe(false);
    expect(storage.map.size).toBe(0);
    expect(locks.requested).toEqual([]);
  });

  it('gives one draft to one note when two tabs start notes at once', async () => {
    const storage = memoryStorage();
    const locks = memoryLocks();
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    const claims = await Promise.all([
      claimLegacyDraft(ID, { storage, locks }),
      claimLegacyDraft(OTHER, { storage, locks }),
    ]);
    expect(claims).toEqual([true, false]);
    expect([...storage.map]).toEqual([[legacyPendingKey(ID), 'draft']]);
  });

  it('re-reads the draft inside the lock', async () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    // Another tab takes the draft while this one waits for the lock.
    const locks = memoryLocks(() => {
      storage.removeItem(LEGACY_DRAFT_KEY);
      storage.setItem(legacyPendingKey(OTHER), 'draft');
    });
    expect(await claimLegacyDraft(ID, { storage, locks })).toBe(false);
    expect([...storage.map]).toEqual([[legacyPendingKey(OTHER), 'draft']]);
  });

  it('keeps the draft, and opens the note empty, when there is no room for the copy', async () => {
    const storage = memoryStorage(1);
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    expect(await claimLegacyDraft(ID, { storage, locks: null })).toBe(false);
    expect([...storage.map]).toEqual([[LEGACY_DRAFT_KEY, 'draft']]);
  });

  it('never throws where storage is denied', async () => {
    const denied = new Proxy({} as Storage, {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(await claimLegacyDraft(ID, { storage: denied, locks: null })).toBe(false);
    const path = await newNotePath({ storage: denied, locks: null });
    expect(isNoteId(path.slice('/n/'.length))).toBe(true);
  });

  it('never throws when the lock is refused, and keeps the draft', async () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    const locks = {
      request: (() => Promise.reject(new DOMException('no', 'SecurityError'))) as unknown,
    } as Pick<LockManager, 'request'>;
    expect(await claimLegacyDraft(ID, { storage, locks })).toBe(false);
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBe('draft');
  });
});

describe('newNotePath', () => {
  it('is a fresh note, with the draft claimed into it', async () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    const path = await newNotePath({ storage, locks: null });
    const id = path.slice('/n/'.length);
    expect(isNoteId(id)).toBe(true);
    expect([...storage.map]).toEqual([[legacyPendingKey(id), 'draft']]);
    expect(await newNotePath({ storage, locks: null })).not.toBe(path);
  });
});
