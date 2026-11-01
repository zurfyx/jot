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
  /** Runs once, inside the next getItem, before it answers: another tab acting meanwhile. */
  onNextRead: (() => void) | null = null;
  /** Called on every write, to check where it happens. */
  onWrite: (() => void) | null = null;
  get length() {
    return this.data.size;
  }
  clear() {
    this.check();
    this.data.clear();
  }
  getItem(key: string) {
    this.check();
    const value = this.data.get(key) ?? null;
    const hook = this.onNextRead;
    this.onNextRead = null;
    hook?.();
    return value;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.check();
    this.onWrite?.();
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.check();
    if (this.full) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.onWrite?.();
    this.data.set(key, value);
  }
  private check() {
    if (this.deny) {
      throw new DOMException('Denied', 'SecurityError');
    }
  }
}

/** Web Locks for one origin: requests for a name run one at a time, in order. */
class FakeLocks {
  held = false;
  private queue: Promise<unknown> = Promise.resolve();
  request(_name: string, callback: () => unknown): Promise<unknown> {
    const run = this.queue.then(async () => {
      this.held = true;
      try {
        return await callback();
      } finally {
        this.held = false;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
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

interface Setup {
  storage?: MemoryStorage;
  locks?: FakeLocks | null;
  events?: EventTarget | null;
}

function setup({ storage = new MemoryStorage(), locks = new FakeLocks(), events }: Setup = {}) {
  const root = fakeRoot();
  const target = events === undefined ? new EventTarget() : events;
  const env: RecentEnv = {
    storage: () => storage,
    now: () => clock,
    locks: locks as unknown as RecentEnv['locks'],
    events: target,
    root: root as unknown as RecentEnv['root'],
  };
  return { storage, locks, events: target, root, store: createRecentStore(env) };
}

function storedState(storage: MemoryStorage) {
  return JSON.parse(storage.data.get(RECENT_KEY) ?? 'null') as {
    entries: { id: string; title: string }[];
    removed: Record<string, number>;
    clearedAt: number;
  } | null;
}

/** Lets queued lock callbacks run (they are promise jobs, not timers). */
async function microtasks() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

const tick = () => {
  clock += 1;
};

beforeEach(() => {
  clock = 1_800_000_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the recent notes list', () => {
  it('records a visit at the top, keeps a known title and moves a reopened note up', async () => {
    const { store } = setup();
    const [a, b] = [generateNoteId(), generateNoteId()];
    await store.recordOpen(a);
    expect(store.read()).toEqual([{ id: a, title: UNTITLED, excerpt: '', openedAt: clock }]);
    await store.updateTitle(a, 'Lisbon trip', 'Flights on the 14th.');
    clock += 1000;
    await store.recordOpen(b);
    clock += 1000;
    await store.recordOpen(a);
    expect(store.read().map((entry) => [entry.id, entry.title, entry.openedAt])).toEqual([
      [a, 'Lisbon trip', clock],
      [b, UNTITLED, clock - 1000],
    ]);
  });

  it(`keeps at most ${RECENT_MAX} notes, dropping the oldest`, async () => {
    const { store, storage } = setup();
    const ids = Array.from({ length: RECENT_MAX + 3 }, () => generateNoteId());
    for (const id of ids) {
      tick();
      await store.recordOpen(id);
    }
    expect(store.read().map((entry) => entry.id)).toEqual(ids.slice(3).reverse());
    expect(storedState(storage)!.entries).toHaveLength(RECENT_MAX);
  });

  it('labels the example, and keeps the label when the note is reopened', async () => {
    const { store } = setup();
    const id = generateNoteId();
    await store.recordOpen(id, { example: true });
    tick();
    await store.recordOpen(id);
    expect(store.read()[0]?.example).toBe(true);
  });

  it('falls back to "Untitled note", collapses whitespace and clips long titles', async () => {
    const { store } = setup();
    const id = generateNoteId();
    await store.recordOpen(id);
    await store.updateTitle(id, '   ', '');
    expect(store.read()[0]?.title).toBe(UNTITLED);
    await store.updateTitle(id, '  Two \n words ', 'and\tthe  rest');
    expect(store.read()[0]).toMatchObject({ title: 'Two words', excerpt: 'and the rest' });
    await store.updateTitle(id, 'word '.repeat(60), '');
    const title = store.read()[0]!.title;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('word…')).toBe(true);
    expect(clip('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('removes one note, and clears them all', async () => {
    const { store, storage } = setup();
    const [a, b] = [generateNoteId(), generateNoteId()];
    await store.recordOpen(a);
    tick();
    await store.recordOpen(b);
    tick();
    await store.remove(a);
    expect(store.read().map((entry) => entry.id)).toEqual([b]);
    expect(storedState(storage)!.removed).toEqual({ [a]: clock });
    tick();
    await store.clear();
    expect(store.read()).toEqual([]);
    expect(storedState(storage)).toEqual({ entries: [], removed: {}, clearedAt: clock });
  });

  it('keeps removals: a title update or an older visit never brings a note back', async () => {
    const { store } = setup();
    const [a, b] = [generateNoteId(), generateNoteId()];
    await store.recordOpen(a);
    tick();
    await store.remove(a);
    await store.updateTitle(a, 'Back again?', '');
    expect(store.read()).toEqual([]);
    // A visit stamped before the removal (another tab's, delivered late) stays out.
    const removedAt = clock;
    clock = removedAt - 10;
    await store.recordOpen(a);
    expect(store.read()).toEqual([]);
    // And one from before the last Clear.
    clock = removedAt + 10;
    await store.recordOpen(b);
    tick();
    await store.clear();
    const clearedAt = clock;
    clock = clearedAt - 5;
    await store.recordOpen(b);
    expect(store.read()).toEqual([]);
    // A real visit after them is recorded, and clears the tombstone.
    clock = clearedAt + 10;
    await store.recordOpen(a);
    expect(store.read().map((entry) => entry.id)).toEqual([a]);
  });

  it('prunes notes not opened for 90 days at read, with no write (D06)', async () => {
    const { store } = setup();
    const [old, recent] = [generateNoteId(), generateNoteId()];
    await store.recordOpen(old);
    clock += NOTE_EXPIRY_MS - 1000;
    await store.recordOpen(recent);
    const before = store.read();
    expect(before).toHaveLength(2);
    expect(store.read()).toBe(before);
    clock += 2000;
    expect(store.read().map((entry) => entry.id)).toEqual([recent]);
  });

  it('reads malformed storage as an empty list, and skips bad or repeated entries', () => {
    const id = generateNoteId();
    expect(parseRecent('not json', clock).entries).toEqual([]);
    expect(parseRecent('[1, 2]', clock).entries).toEqual([]);
    expect(parseRecent('{"entries": 1}', clock).entries).toEqual([]);
    expect(
      parseRecent(
        JSON.stringify({
          entries: [
            null,
            { id: 'public', title: 'x', openedAt: clock },
            { id, title: 42, openedAt: clock },
            { id, title: 'Duplicate', openedAt: clock - 5 },
            { id: generateNoteId(), title: 'No time' },
          ],
          removed: { public: 1, [generateNoteId()]: 'later' },
          clearedAt: 'never',
        }),
        clock,
      ),
    ).toEqual({
      entries: [{ id, title: UNTITLED, excerpt: '', openedAt: clock }],
      removed: {},
      clearedAt: 0,
    });
  });

  it('never throws where storage is denied or full', async () => {
    const storage = new MemoryStorage();
    storage.deny = true;
    const { store } = setup({ storage });
    const id = generateNoteId();
    await expect(
      (async () => {
        await store.recordOpen(id);
        await store.updateTitle(id, 'Title', '');
        await store.remove(id);
        await store.clear();
      })(),
    ).resolves.toBeUndefined();
    expect(store.read()).toEqual([]);

    const full = new MemoryStorage();
    const other = setup({ storage: full });
    await other.store.recordOpen(id);
    full.full = true;
    tick();
    await expect(other.store.recordOpen(generateNoteId())).resolves.toBeUndefined();
    expect(other.store.read().map((entry) => entry.id)).toEqual([id]);
  });

  it('marks <html> with the rows the landing page reserves', async () => {
    const { store, root } = setup();
    expect(reservedRows(0)).toEqual([0, 0]);
    expect(reservedRows(3)).toEqual([3, 2]);
    expect(reservedRows(19)).toEqual([6, 3]);
    for (const id of Array.from({ length: 3 }, () => generateNoteId())) {
      tick();
      await store.recordOpen(id);
    }
    expect(root.attributes.has(RECENT_ATTR)).toBe(true);
    expect(root.vars.get(RECENT_ROWS_VAR)).toBe('3');
    expect(root.vars.get(RECENT_ROWS_WIDE_VAR)).toBe('2');
    tick();
    await store.clear();
    expect(root.attributes.has(RECENT_ATTR)).toBe(false);
    expect(root.vars.get(RECENT_ROWS_VAR)).toBe('0');
  });

  it('brings a stale mark up to date on subscribe (cleared in another tab meanwhile)', async () => {
    const storage = new MemoryStorage();
    const mine = setup({ storage });
    const theirs = setup({ storage, events: null });
    await mine.store.recordOpen(generateNoteId());
    expect(mine.root.attributes.has(RECENT_ATTR)).toBe(true);
    // Nobody here listens (a note page is open) while the other tab clears.
    tick();
    await theirs.store.clear();
    expect(mine.root.attributes.has(RECENT_ATTR)).toBe(true);
    // Back on the landing page, the section subscribes.
    const unsubscribe = mine.store.subscribe(() => undefined);
    expect(mine.root.attributes.has(RECENT_ATTR)).toBe(false);
    expect(mine.root.vars.get(RECENT_ROWS_WIDE_VAR)).toBe('0');
    unsubscribe();
  });

  it('follows another tab through the storage event', async () => {
    const storage = new MemoryStorage();
    const events = new EventTarget();
    const mine = setup({ storage, events });
    const theirs = setup({ storage, events: null });
    const onChange = vi.fn();
    const unsubscribe = mine.store.subscribe(onChange);
    expect(mine.store.read()).toEqual([]);

    const id = generateNoteId();
    await theirs.store.recordOpen(id);
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

  it('returns the same list until storage changes, as useSyncExternalStore needs', async () => {
    const { store } = setup();
    await store.recordOpen(generateNoteId());
    expect(store.read()).toBe(store.read());
  });
});

describe('changes from several tabs', () => {
  it('run one at a time inside the Web Lock, each on a fresh read', async () => {
    const storage = new MemoryStorage();
    const locks = new FakeLocks();
    storage.onWrite = () => expect(locks.held).toBe(true);
    const a = setup({ storage, locks });
    const b = setup({ storage, locks });
    const [x, y] = [generateNoteId(), generateNoteId()];
    // Two tabs record visits at once: neither write loses the other's.
    await Promise.all([a.store.recordOpen(x), b.store.recordOpen(y)]);
    expect(
      a.store
        .read()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([x, y].sort());
  });

  it("a title write racing another tab's Clear can't bring the note back", async () => {
    const storage = new MemoryStorage();
    const locks = new FakeLocks();
    const a = setup({ storage, locks });
    const b = setup({ storage, locks });
    const x = generateNoteId();
    await a.store.recordOpen(x);
    tick();
    // While tab A reads the list for its title write, tab B clears it.
    let cleared: Promise<void> = Promise.resolve();
    storage.onNextRead = () => {
      cleared = b.store.clear();
    };
    await a.store.updateTitle(x, 'Typed meanwhile', '');
    await cleared;
    expect(a.store.read()).toEqual([]);
    expect(storedState(storage)!.clearedAt).toBe(clock);
  });

  it('without Web Locks every change still applies, unsynchronised', async () => {
    const { store } = setup({ locks: null });
    const x = generateNoteId();
    await store.recordOpen(x);
    await store.updateTitle(x, 'No locks here', '');
    expect(store.read()[0]?.title).toBe('No locks here');
  });

  it('a lock request that throws or rejects falls back to changing at once', async () => {
    const throwing = {
      request: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    };
    const rejecting = { request: () => Promise.reject(new DOMException('Aborted', 'AbortError')) };
    for (const locks of [throwing, rejecting]) {
      const { store } = setup({ locks: locks as unknown as FakeLocks });
      const x = generateNoteId();
      await store.recordOpen(x);
      expect(store.read().map((entry) => entry.id)).toEqual([x]);
    }
  });

  it('a sync change (pagehide) writes before the lock would be granted', async () => {
    const locks = new FakeLocks();
    const { store } = setup({ locks });
    const x = generateNoteId();
    await store.recordOpen(x);
    // Something else holds the lock; a sync write doesn't wait for it.
    let release = () => {};
    void locks.request('jot:recent', () => new Promise<void>((resolve) => (release = resolve)));
    void store.updateTitle(x, 'Written on pagehide', '', { sync: true });
    expect(store.read()[0]?.title).toBe('Written on pagehide');
    release();
  });
});

describe('title updates while typing', () => {
  it(`read the note only when a write goes through: at once, then at most every ${TITLE_THROTTLE_MS} ms`, async () => {
    vi.useFakeTimers();
    const { store } = setup();
    const id = generateNoteId();
    await store.recordOpen(id);
    let text = 'L';
    const read = vi.fn(() => [text, ''] as [string, string]);
    const recorder = store.titleRecorder(id, read);
    const title = () => store.read()[0]!.title;

    recorder.changed();
    expect(read).toHaveBeenCalledTimes(1);
    await microtasks();
    expect(title()).toBe('L');
    clock += 500;
    text = 'Li';
    recorder.changed();
    clock += 500;
    text = 'Lis';
    recorder.changed();
    recorder.changed();
    // Changes only mark the title stale: nothing is read until the timer.
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1400);
    expect(read).toHaveBeenCalledTimes(1);
    clock += 1000;
    vi.advanceTimersByTime(100);
    expect(read).toHaveBeenCalledTimes(2);
    await microtasks();
    expect(title()).toBe('Lis');

    // A flush (hidden page, leaving it) reads and writes the pending title now.
    text = 'Lisbon';
    recorder.changed();
    expect(read).toHaveBeenCalledTimes(2);
    recorder.flush({ sync: true });
    expect(read).toHaveBeenCalledTimes(3);
    expect(title()).toBe('Lisbon');
    vi.advanceTimersByTime(TITLE_THROTTLE_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reads and writes nothing on a flush with nothing pending', () => {
    const { store } = setup();
    const id = generateNoteId();
    const read = vi.fn(() => ['x', ''] as [string, string]);
    const onChange = vi.fn();
    store.subscribe(onChange);
    store.titleRecorder(id, read).flush();
    expect(read).not.toHaveBeenCalled();
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
