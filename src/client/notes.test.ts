import { describe, expect, it } from 'vitest';

import { isNoteId } from '../shared/ids';
import { claimLegacyDraft, LEGACY_DRAFT_KEY, legacyPendingKey } from './notes';

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

const ID = 'k3Jd9xQ2aaaaaaaaaaaaaA';

describe('claimLegacyDraft', () => {
  it("moves an earlier version's draft to the new note's pending copy", () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, '{"id":"d","state":"AA=="}');
    claimLegacyDraft(ID, storage);
    expect(storage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(storage.getItem(legacyPendingKey(ID))).toBe('{"id":"d","state":"AA=="}');
  });

  it('does nothing without a draft, and only once with one', () => {
    const storage = memoryStorage();
    claimLegacyDraft(ID, storage);
    expect(storage.map.size).toBe(0);
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    claimLegacyDraft(ID, storage);
    claimLegacyDraft('k3Jd9xQ2bbbbbbbbbbbbbA', storage);
    expect([...storage.map.keys()]).toEqual([legacyPendingKey(ID)]);
  });

  it('frees the draft slot first when there is room for one copy only', () => {
    const storage = memoryStorage(1);
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    claimLegacyDraft(ID, storage);
    expect([...storage.map]).toEqual([[legacyPendingKey(ID), 'draft']]);
  });

  it('keeps the draft when the copy cannot be written at all', () => {
    const storage = memoryStorage(1);
    storage.setItem(LEGACY_DRAFT_KEY, 'draft');
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key !== LEGACY_DRAFT_KEY) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      setItem(key, value);
    };
    claimLegacyDraft(ID, storage);
    expect([...storage.map]).toEqual([[LEGACY_DRAFT_KEY, 'draft']]);
  });

  it('pending keys name a valid note id', () => {
    expect(isNoteId(legacyPendingKey(ID).slice('jot:pending:'.length))).toBe(true);
  });
});
