import { useSyncExternalStore } from 'react';

import { isNoteId } from '../shared/ids';
import { NOTE_EXPIRY_MS } from '../shared/limits';

/**
 * Recently opened notes (D30): a list kept in this browser's localStorage, so
 * the landing page can offer the notes you opened. Nothing about it reaches
 * the server. Kept free of Lexical and Yjs so the landing page stays light,
 * and it never throws: where storage is denied the list is simply empty.
 *
 * Every tab of the origin shares the list. A change re-reads it and writes it
 * back inside the Web Lock `jot:recent`, so two tabs never interleave, and a
 * removal or a Clear leaves a time behind (a tombstone, `clearedAt`) that a
 * visit from before it can't undo. Where Web Locks are missing, and on
 * `pagehide`, the change runs at once, unsynchronised.
 *
 * The relay can't tell an expired note from a new one (an expired note's
 * object deletes its storage and opens empty, D06), so an entry this browser
 * hasn't opened for 90 days is pruned instead of marked.
 */

export const RECENT_KEY = 'jot:recent';
export const RECENT_LOCK = 'jot:recent';
/** The most entries the list keeps; opening a 21st drops the oldest. */
export const RECENT_MAX = 20;
/** The landing page shows this many before "Show all". */
export const RECENT_SHOWN = 6;
/** A note whose first line is empty. */
export const UNTITLED = 'Untitled note';
/** At most one title write per this many ms while typing. */
export const TITLE_THROTTLE_MS = 2000;

const TITLE_MAX = 120;
const EXCERPT_MAX = 160;
/** Removals remembered at most; older ones go first. */
const TOMBSTONES_MAX = 100;

/** On <html> while the list has entries, set before the first paint (index.html). */
export const RECENT_ATTR = 'data-recent';
/** The rows the landing page shows: on a phone, and in two columns on wider screens. */
export const RECENT_ROWS_VAR = '--jot-recent-rows';
export const RECENT_ROWS_WIDE_VAR = '--jot-recent-rows-wide';

export interface RecentNote {
  id: string;
  /** The note's first line, or "Untitled note". */
  title: string;
  /** The start of the text after the first line. */
  excerpt: string;
  /** When this browser last opened it (ms since the epoch). */
  openedAt: number;
  /** The example note this browser started (D20). */
  example?: true;
}

/** What `jot:recent` holds. */
export interface RecentState {
  entries: RecentNote[];
  /** When each note was last removed: a visit from before it is not recorded. */
  removed: Record<string, number>;
  /** When the list was last cleared: a visit from before it is not recorded. */
  clearedAt: number;
}

type Locks = Pick<LockManager, 'request'>;

/** What a store reads and writes; the app's is the window's, tests pass fakes. */
export interface RecentEnv {
  /** The storage, read inside a guard: it throws where storage is denied. */
  storage: () => Storage;
  now: () => number;
  /** Web Locks, or null where they are missing. */
  locks: Locks | null;
  /** Where `storage` events arrive from other tabs. */
  events: EventTarget | null;
  /** <html>, which carries the hint the landing page sizes its slot by. */
  root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute' | 'style'> | null;
}

/** Collapses whitespace and cuts `text` to `max` characters on a word, with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function titleOf(firstLine: string): string {
  return clip(firstLine, TITLE_MAX) || UNTITLED;
}

const EMPTY_STATE: RecentState = { entries: [], removed: {}, clearedAt: 0 };

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parses the stored state: well-formed, unexpired entries, one per note, none
 * from before its removal or the last Clear, newest first, capped.
 */
export function parseRecent(raw: string | null, now: number): RecentState {
  if (raw === null) {
    return EMPTY_STATE;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_STATE;
  }
  const stored = value as Record<string, unknown>;
  const clearedAt = isTime(stored.clearedAt) ? stored.clearedAt : 0;
  const removed: Record<string, number> = {};
  if (typeof stored.removed === 'object' && stored.removed !== null) {
    for (const [id, at] of Object.entries(stored.removed as Record<string, unknown>)) {
      // A removal older than the expiry can't outrank any entry still kept.
      if (isNoteId(id) && isTime(at) && now - at <= NOTE_EXPIRY_MS) {
        removed[id] = at;
      }
    }
  }
  const seen = new Set<string>();
  const entries: RecentNote[] = [];
  for (const item of Array.isArray(stored.entries) ? (stored.entries as unknown[]) : []) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { id, title, excerpt, openedAt, example } = item as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !isNoteId(id) ||
      seen.has(id) ||
      !isTime(openedAt) ||
      now - openedAt > NOTE_EXPIRY_MS ||
      openedAt <= clearedAt ||
      openedAt <= (removed[id] ?? -Infinity)
    ) {
      continue;
    }
    seen.add(id);
    entries.push({
      id,
      title: typeof title === 'string' && title.trim() !== '' ? clip(title, TITLE_MAX) : UNTITLED,
      excerpt: typeof excerpt === 'string' ? clip(excerpt, EXCERPT_MAX) : '',
      openedAt,
      ...(example === true ? { example: true as const } : {}),
    });
  }
  entries.sort((a, b) => b.openedAt - a.openedAt);
  return { entries: entries.slice(0, RECENT_MAX), removed, clearedAt };
}

/** The rows the landing page reserves for `count` entries: [phone, two columns]. */
export function reservedRows(count: number): [number, number] {
  const shown = Math.min(count, RECENT_SHOWN);
  return [shown, Math.ceil(shown / 2)];
}

/** A note's first line and the text after it, as the editor has them now. */
export type ReadNote = () => [firstLine: string, rest: string];

export interface TitleRecorder {
  /** The note changed: its text is read, and written, when the throttle allows. */
  changed(): void;
  /**
   * Writes the title now if a change is pending. `sync` writes without the
   * lock, for `pagehide`, when the page may be gone before a lock is granted.
   */
  flush(options?: { sync?: boolean }): void;
}

export interface RecentStore {
  /** The list, newest first, pruned against the current time. */
  read(): RecentNote[];
  /** A visit now: the note moves to the top, keeping the title it had. */
  recordOpen(id: string, options?: { example?: boolean }): Promise<void>;
  /**
   * The title and excerpt of a listed note, read from the note by `read` when
   * the write runs (inside the lock), never when it is queued: a write that
   * waited always writes the latest text. Resolves to whether the note now
   * has that title; false when it isn't listed or storage refused the write.
   */
  updateTitle(id: string, read: ReadNote, options?: { sync?: boolean }): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Subscribing also brings <html>'s hint up to date. */
  subscribe(onChange: () => void): () => void;
  /**
   * Title updates for one open note: `read` gives its first line and the text
   * after it, and is called at most once per `intervalMs`.
   */
  titleRecorder(id: string, read: ReadNote, intervalMs?: number): TitleRecorder;
}

export function createRecentStore(env: RecentEnv): RecentStore {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: RecentState = EMPTY_STATE;

  const rawValue = (): string | null => {
    try {
      return env.storage().getItem(RECENT_KEY);
    } catch {
      return null;
    }
  };

  /** The state, re-parsed when storage changed or an entry has expired since. */
  const state = (): RecentState => {
    const raw = rawValue();
    const now = env.now();
    if (
      raw !== cachedRaw ||
      cached.entries.some((entry) => now - entry.openedAt > NOTE_EXPIRY_MS)
    ) {
      cachedRaw = raw;
      cached = parseRecent(raw, now);
    }
    return cached;
  };

  const read = () => state().entries;

  const hint = () => {
    const root = env.root;
    if (root === null) {
      return;
    }
    const count = read().length;
    if (count === 0) {
      root.removeAttribute(RECENT_ATTR);
    } else {
      root.setAttribute(RECENT_ATTR, '');
    }
    const [rows, wide] = reservedRows(count);
    root.style.setProperty(RECENT_ROWS_VAR, String(rows));
    root.style.setProperty(RECENT_ROWS_WIDE_VAR, String(wide));
  };

  const notify = () => {
    hint();
    for (const listener of [...listeners]) {
      // One failing subscriber neither stops the others nor fails the change.
      try {
        listener();
      } catch (error) {
        console.error('jot: a recent notes subscriber failed', error);
      }
    }
  };

  /**
   * Writes `next`, merged with what storage holds at this moment: the newest
   * Clear and removals of both win, and no entry from before them is written.
   * So a write computed from an older read (lock-free, on `pagehide`) can't
   * undo a Clear or a removal that landed meanwhile.
   */
  const write = (next: RecentState): boolean => {
    try {
      const storage = env.storage();
      const stored = parseRecent(storage.getItem(RECENT_KEY), env.now());
      const clearedAt = Math.max(next.clearedAt, stored.clearedAt);
      const merged: Record<string, number> = { ...stored.removed };
      for (const [id, at] of Object.entries(next.removed)) {
        merged[id] = Math.max(at, merged[id] ?? -Infinity);
      }
      const entries = next.entries
        .filter(
          (entry) => entry.openedAt > clearedAt && entry.openedAt > (merged[entry.id] ?? -Infinity),
        )
        .slice(0, RECENT_MAX);
      const removed = Object.entries(merged)
        // A tombstone the Clear covers, or one a newer visit outlived, says nothing more.
        .filter(
          ([id, at]) =>
            at > clearedAt && !entries.some((entry) => entry.id === id && entry.openedAt > at),
        )
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOMBSTONES_MAX);
      if (entries.length === 0 && removed.length === 0 && clearedAt === 0) {
        storage.removeItem(RECENT_KEY);
      } else {
        storage.setItem(
          RECENT_KEY,
          JSON.stringify({ entries, removed: Object.fromEntries(removed), clearedAt }),
        );
      }
      return true;
    } catch {
      // Denied or full: the list is a convenience, never an error.
      return false;
    }
  };

  /**
   * Re-reads the state and writes `change(state)` back (unless it returns
   * null), inside the lock unless `sync`, then tells subscribers.
   */
  const mutate = (
    change: (current: RecentState) => RecentState | null,
    options: { sync?: boolean } = {},
    onWritten?: (ok: boolean) => void,
  ): Promise<void> => {
    let applied = false;
    const apply = () => {
      applied = true;
      const next = change(state());
      if (next !== null) {
        // Written first: an optional call skips its arguments when there is no callback.
        const ok = write(next);
        onWritten?.(ok);
        notify();
      }
    };
    const locks = env.locks;
    if (options.sync || locks === null) {
      apply();
      return Promise.resolve();
    }
    try {
      // Only a lock that was never granted falls back to changing at once.
      return locks.request(RECENT_LOCK, apply).catch(() => {
        if (!applied) {
          apply();
        }
      });
    } catch {
      apply();
      return Promise.resolve();
    }
  };

  const updateTitle: RecentStore['updateTitle'] = async (id, readNote, options = {}) => {
    let landed = false;
    await mutate(
      (current) => {
        const index = current.entries.findIndex((entry) => entry.id === id);
        const entry = current.entries[index];
        if (entry === undefined) {
          return null;
        }
        // Read now, inside the lock: whatever waited, this is the latest text.
        const [firstLine, rest] = readNote();
        const title = titleOf(firstLine);
        const excerpt = clip(rest, EXCERPT_MAX);
        if (entry.title === title && entry.excerpt === excerpt) {
          landed = true;
          return null;
        }
        const entries = [...current.entries];
        entries[index] = { ...entry, title, excerpt };
        return { ...current, entries };
      },
      options,
      (ok) => {
        landed = ok;
      },
    );
    return landed;
  };

  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === RECENT_KEY || key === null) {
      notify();
    }
  };

  return {
    read,
    recordOpen(id, options = {}) {
      if (!isNoteId(id)) {
        return Promise.resolve();
      }
      // The visit's time is now, not when the lock is granted.
      const openedAt = env.now();
      return mutate((current) => {
        if (openedAt <= current.clearedAt || openedAt <= (current.removed[id] ?? -Infinity)) {
          return null;
        }
        const known = current.entries.find((entry) => entry.id === id);
        const example = options.example === true || known?.example === true;
        const entry: RecentNote = {
          id,
          title: known?.title ?? UNTITLED,
          excerpt: known?.excerpt ?? '',
          openedAt,
          ...(example ? { example: true as const } : {}),
        };
        const removed = { ...current.removed };
        delete removed[id];
        return {
          ...current,
          removed,
          entries: [entry, ...current.entries.filter((other) => other.id !== id)],
        };
      });
    },
    updateTitle,
    remove(id) {
      const at = env.now();
      return mutate((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.id !== id),
        removed: { ...current.removed, [id]: Math.max(at, current.removed[id] ?? 0) },
      }));
    },
    clear() {
      const at = env.now();
      return mutate((current) => ({
        entries: [],
        removed: {},
        clearedAt: Math.max(at, current.clearedAt),
      }));
    },
    subscribe(onChange) {
      listeners.add(onChange);
      if (listeners.size === 1) {
        env.events?.addEventListener('storage', onStorage);
      }
      // Another tab may have changed the list while nobody here listened.
      hint();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          env.events?.removeEventListener('storage', onStorage);
        }
      };
    },
    titleRecorder(id, readNote, intervalMs = TITLE_THROTTLE_MS) {
      // Changes seen, and the latest one a landed write has read: a change
      // stays pending until a write that read it lands, so a flush while an
      // earlier write waits for the lock (pagehide), or one that found the note
      // unlisted, writes again.
      let changes = 0;
      let landed = 0;
      let lastWrite = -Infinity;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = (options: { sync?: boolean } = {}) => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (changes === landed) {
          return;
        }
        lastWrite = env.now();
        let read = landed;
        const readNow: ReadNote = () => {
          read = changes;
          return readNote();
        };
        void updateTitle(id, readNow, options).then((ok) => {
          if (ok) {
            landed = Math.max(landed, read);
          }
        });
      };
      return {
        changed() {
          changes += 1;
          if (timer !== null) {
            return;
          }
          const wait = lastWrite + intervalMs - env.now();
          if (wait <= 0) {
            flush();
          } else {
            timer = setTimeout(() => flush(), wait);
          }
        },
        flush,
      };
    },
  };
}

/** This window's list. */
export const recentNotes = createRecentStore({
  storage: () => window.localStorage,
  now: () => Date.now(),
  locks: typeof navigator === 'undefined' ? null : (navigator.locks ?? null),
  events: typeof window === 'undefined' ? null : window,
  root: typeof document === 'undefined' ? null : document.documentElement,
});

const EMPTY: RecentNote[] = [];

/**
 * The list, for the landing page. The server snapshot is empty, so a
 * prerendered page renders the section's slot empty and the client fills it
 * on its first paint.
 */
export function useRecentNotes(): RecentNote[] {
  return useSyncExternalStore(recentNotes.subscribe, recentNotes.read, () => EMPTY);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How often the landing page refreshes its relative times while visible. */
export const OPENED_REFRESH_MS = MINUTE;

/** When a note was last opened: "Just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", "Oct 2". */
export function openedLabel(openedAt: number, now: number): string {
  const ago = Math.max(0, now - openedAt);
  if (ago < MINUTE) {
    return 'Just now';
  }
  if (ago < HOUR) {
    return `${Math.floor(ago / MINUTE)} min ago`;
  }
  if (ago < DAY) {
    return `${Math.floor(ago / HOUR)} h ago`;
  }
  if (ago < 2 * DAY) {
    return 'Yesterday';
  }
  if (ago < 7 * DAY) {
    return `${Math.floor(ago / DAY)} days ago`;
  }
  return new Date(openedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
