import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateNoteId } from '../shared/ids';
import { NOTE_EXPIRY_MS } from '../shared/limits';
import {
  clip,
  createRecentStore,
  openedLabel,
  parseRecent,
  RECENT_ATTR,
  RECENT_KEY,
  RECENT_MAX,
  RECENT_ROWS_VAR,
  RECENT_ROWS_WIDE_VAR,
  type RecentEnv,
  reservedRows,
  TITLE_THROTTLE_MS,
  UNTITLED,
} from './recent';

/** A Storage in memory; `deny` makes every call throw, as a denied localStorage does. */
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  deny = false;
  /** Throws on setItem only, as a full localStorage does. */
  full = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.check();
    this.data.clear();
  }
  getItem(key: string) {
    this.check();
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.check();
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.check();
    if (this.full) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.data.set(key, value);
  }
  private check() {
    if (this.deny) {
      throw new DOMException('Denied', 'SecurityError');
    }
  }
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  const vars = new Map<string, string>();
  return {
    attributes,
    vars,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    style: { setProperty: (name: string, value: string) => vars.set(name, value) },
  };
}

let clock = 1_800_000_000_000;

function setup(storage = new MemoryStorage(), events: EventTarget | null = new EventTarget()) {
  const root = fakeRoot();
  const env: RecentEnv = {
    storage: () => storage,
    now: () => clock,
    events,
    root: root as unknown as RecentEnv['root'],
  };
  return { storage, events, root, store: createRecentStore(env) };
}

beforeEach(() => {
  clock = 1_800_000_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the recent notes list', () => {
  it('records a visit at the top, keeps a known title and moves a reopened note up', () => {
    const { store } = setup();
    const [a, b] = [generateNoteId(), generateNoteId()];
    store.recordOpen(a);
    expect(store.read()).toEqual([{ id: a, title: UNTITLED, excerpt: '', openedAt: clock }]);
    store.updateTitle(a, 'Lisbon trip', 'Flights on the 14th.');
    clock += 1000;
    store.recordOpen(b);
    clock += 1000;
    store.recordOpen(a);
    expect(store.read().map((entry) => [entry.id, entry.title, entry.openedAt])).toEqual([
      [a, 'Lisbon trip', clock],
      [b, UNTITLED, clock - 1000],
    ]);
  });

  it(`keeps at most ${RECENT_MAX} notes, dropping the oldest`, () => {
    const { store, storage } = setup();
    const ids = Array.from({ length: RECENT_MAX + 3 }, () => generateNoteId());
    for (const id of ids) {
      clock += 1;
      store.recordOpen(id);
    }
    expect(store.read().map((entry) => entry.id)).toEqual(ids.slice(3).reverse());
    expect(JSON.parse(storage.data.get(RECENT_KEY)!)).toHaveLength(RECENT_MAX);
  });

  it('labels the example, and keeps the label when the note is reopened', () => {
    const { store } = setup();
    const id = generateNoteId();
    store.recordOpen(id, { example: true });
    store.recordOpen(id);
    expect(store.read()[0]?.example).toBe(true);
  });

  it('falls back to "Untitled note", collapses whitespace and clips long titles', () => {
    const { store } = setup();
    const id = generateNoteId();
    store.recordOpen(id);
    store.updateTitle(id, '   ', '');
    expect(store.read()[0]?.title).toBe(UNTITLED);
    store.updateTitle(id, '  Two \n words ', 'and\tthe  rest');
    expect(store.read()[0]).toMatchObject({ title: 'Two words', excerpt: 'and the rest' });
    store.updateTitle(id, 'word '.repeat(60), '');
    const title = store.read()[0]!.title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('word…')).toBe(true);
    expect(clip('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('never re-adds a removed note when its title changes', () => {
    const { store } = setup();
    const id = generateNoteId();
    store.recordOpen(id);
    store.remove(id);
    store.updateTitle(id, 'Back again?', '');
    expect(store.read()).toEqual([]);
  });

  it('removes one note, and clears them all', () => {
    const { store, storage } = setup();
    const [a, b] = [generateNoteId(), generateNoteId()];
    store.recordOpen(a);
    store.recordOpen(b);
    store.remove(a);
    expect(store.read().map((entry) => entry.id)).toEqual([b]);
    store.clear();
    expect(store.read()).toEqual([]);
    expect(storage.data.has(RECENT_KEY)).toBe(false);
  });

  it('prunes notes not opened for 90 days: the relay deletes them (D06)', () => {
    const { store } = setup();
    const [old, recent] = [generateNoteId(), generateNoteId()];
    store.recordOpen(old);
    clock += NOTE_EXPIRY_MS - 1000;
    store.recordOpen(recent);
    expect(store.read()).toHaveLength(2);
    clock += 2000;
    // A new write re-reads the list with the new time.
    store.updateTitle(recent, 'Still here', '');
    expect(store.read().map((entry) => entry.id)).toEqual([recent]);
    expect(parseRecent(JSON.stringify([{ id: old, title: 'x', openedAt: 0 }]), clock)).toEqual([]);
  });

  it('reads malformed storage as an empty list, and skips bad or repeated entries', () => {
    const id = generateNoteId();
    expect(parseRecent('not json', clock)).toEqual([]);
    expect(parseRecent('{"id":1}', clock)).toEqual([]);
    expect(
      parseRecent(
        JSON.stringify([
          null,
          { id: 'public', title: 'x', openedAt: clock },
          { id, title: 42, openedAt: clock },
          { id, title: 'Duplicate', openedAt: clock - 5 },
          { id: generateNoteId(), title: 'No time' },
        ]),
        clock,
      ),
    ).toEqual([{ id, title: UNTITLED, excerpt: '', openedAt: clock }]);
  });

  it('never throws where storage is denied or full', () => {
    const storage = new MemoryStorage();
    storage.deny = true;
    const { store } = setup(storage);
    const id = generateNoteId();
    expect(() => {
      store.recordOpen(id);
      store.updateTitle(id, 'Title', '');
      store.remove(id);
      store.clear();
    }).not.toThrow();
    expect(store.read()).toEqual([]);

    const full = new MemoryStorage();
    const other = setup(full);
    other.store.recordOpen(id);
    full.full = true;
    expect(() => other.store.recordOpen(generateNoteId())).not.toThrow();
    expect(other.store.read().map((entry) => entry.id)).toEqual([id]);
  });

  it('marks <html> with the rows the landing page reserves', () => {
    const { store, root } = setup();
    expect(reservedRows(0)).toEqual([0, 0]);
    expect(reservedRows(3)).toEqual([3, 2]);
    expect(reservedRows(19)).toEqual([6, 3]);
    const ids = Array.from({ length: 3 }, () => generateNoteId());
    ids.forEach((id) => store.recordOpen(id));
    expect(root.attributes.has(RECENT_ATTR)).toBe(true);
    expect(root.vars.get(RECENT_ROWS_VAR)).toBe('3');
    expect(root.vars.get(RECENT_ROWS_WIDE_VAR)).toBe('2');
    store.clear();
    expect(root.attributes.has(RECENT_ATTR)).toBe(false);
    expect(root.vars.get(RECENT_ROWS_VAR)).toBe('0');
  });

  it('follows another tab through the storage event', () => {
    const storage = new MemoryStorage();
    const events = new EventTarget();
    const mine = setup(storage, events);
    const theirs = setup(storage, null);
    const onChange = vi.fn();
    const unsubscribe = mine.store.subscribe(onChange);
    expect(mine.store.read()).toEqual([]);

    const id = generateNoteId();
    theirs.store.recordOpen(id);
    // Another tab's write arrives as a storage event, never as a call here.
    expect(onChange).not.toHaveBeenCalled();
    events.dispatchEvent(Object.assign(new Event('storage'), { key: RECENT_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mine.store.read().map((entry) => entry.id)).toEqual([id]);
    expect(mine.root.attributes.has(RECENT_ATTR)).toBe(true);

    // Other keys are not ours; a cleared storage (key null) is.
    events.dispatchEvent(Object.assign(new Event('storage'), { key: 'jot:theme' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    events.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    events.dispatchEvent(Object.assign(new Event('storage'), { key: RECENT_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('returns the same list until storage changes, as useSyncExternalStore needs', () => {
    const { store } = setup();
    store.recordOpen(generateNoteId());
    expect(store.read()).toBe(store.read());
  });
});

describe('title updates while typing', () => {
  it(`write at once, then at most every ${TITLE_THROTTLE_MS} ms, with the latest title`, () => {
    vi.useFakeTimers();
    const { store } = setup();
    const id = generateNoteId();
    store.recordOpen(id);
    const recorder = store.titleRecorder(id);
    const title = () => store.read()[0]!.title;

    recorder.update('L', '');
    expect(title()).toBe('L');
    clock += 500;
    recorder.update('Li', '');
    clock += 500;
    recorder.update('Lis', '');
    expect(title()).toBe('L');
    // The timer set at 500 ms runs 2000 ms after the first write.
    vi.advanceTimersByTime(1400);
    expect(title()).toBe('L');
    clock += 1000;
    vi.advanceTimersByTime(100);
    expect(title()).toBe('Lis');

    // A flush (pagehide, leaving the page) writes the pending title now.
    recorder.update('Lisbon', '');
    expect(title()).toBe('Lis');
    recorder.flush();
    expect(title()).toBe('Lisbon');
    vi.advanceTimersByTime(TITLE_THROTTLE_MS);
    expect(title()).toBe('Lisbon');
  });

  it('writes nothing on a flush with nothing pending', () => {
    const { store } = setup();
    const id = generateNoteId();
    store.recordOpen(id);
    const onChange = vi.fn();
    store.subscribe(onChange);
    store.titleRecorder(id).flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('when a note was last opened', () => {
  it('reads as a short relative time, then a date', () => {
    const now = Date.UTC(2026, 9, 31, 12);
    expect(openedLabel(now - 10_000, now)).toBe('Just now');
    expect(openedLabel(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(openedLabel(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(openedLabel(now - 30 * 3_600_000, now)).toBe('Yesterday');
    expect(openedLabel(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(openedLabel(Date.UTC(2026, 9, 2, 12), now)).toBe('Oct 2');
    expect(openedLabel(now + 60_000, now)).toBe('Just now');
  });
});
