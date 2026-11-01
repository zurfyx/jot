import { useSyncExternalStore } from 'react';

import { isNoteId } from '../shared/ids';
import { NOTE_EXPIRY_MS } from '../shared/limits';

/**
 * Recently opened notes (D30): a list kept in this browser's localStorage, so
 * the landing page can offer the notes you opened. Nothing about it reaches
 * the server. Kept free of Lexical and Yjs so the landing page stays light,
 * and it never throws: where storage is denied the list is simply empty.
 *
 * The relay can't tell an expired note from a new one (an expired note's
 * object deletes its storage and opens empty, D06), so an entry this browser
 * hasn't opened for 90 days is pruned instead of marked.
 */

export const RECENT_KEY = 'jot:recent';
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

/** What a store reads and writes; the app's is the window's, tests pass fakes. */
export interface RecentEnv {
  /** The storage, read inside a guard: it throws where storage is denied. */
  storage: () => Storage;
  now: () => number;
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

/** Parses the stored list: well-formed, unexpired, one entry per note, newest first, capped. */
export function parseRecent(raw: string | null, now: number): RecentNote[] {
  if (raw === null) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const list: RecentNote[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { id, title, excerpt, openedAt, example } = item as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !isNoteId(id) ||
      seen.has(id) ||
      typeof openedAt !== 'number' ||
      !Number.isFinite(openedAt) ||
      now - openedAt > NOTE_EXPIRY_MS
    ) {
      continue;
    }
    seen.add(id);
    list.push({
      id,
      title: typeof title === 'string' && title.trim() !== '' ? clip(title, TITLE_MAX) : UNTITLED,
      excerpt: typeof excerpt === 'string' ? clip(excerpt, EXCERPT_MAX) : '',
      openedAt,
      ...(example === true ? { example: true as const } : {}),
    });
  }
  return list.sort((a, b) => b.openedAt - a.openedAt).slice(0, RECENT_MAX);
}

/** The rows the landing page reserves for `count` entries: [phone, two columns]. */
export function reservedRows(count: number): [number, number] {
  const shown = Math.min(count, RECENT_SHOWN);
  return [shown, Math.ceil(shown / 2)];
}

export interface TitleRecorder {
  /** The note's first line and the text after it, as the editor has them now. */
  update(firstLine: string, rest: string): void;
  /** Writes what `update` last got, if it hasn't been written. */
  flush(): void;
}

export interface RecentStore {
  read(): RecentNote[];
  /** A visit: the note moves to the top, keeping the title it had. */
  recordOpen(id: string, options?: { example?: boolean }): void;
  /** A new title and excerpt for a listed note; one that was removed stays removed. */
  updateTitle(id: string, firstLine: string, rest: string): void;
  remove(id: string): void;
  clear(): void;
  subscribe(onChange: () => void): () => void;
  /** Title updates for one open note, at most one write per `intervalMs`. */
  titleRecorder(id: string, intervalMs?: number): TitleRecorder;
}

export function createRecentStore(env: RecentEnv): RecentStore {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: RecentNote[] = [];

  const rawValue = (): string | null => {
    try {
      return env.storage().getItem(RECENT_KEY);
    } catch {
      return null;
    }
  };

  const hint = (list: RecentNote[]) => {
    const root = env.root;
    if (root === null) {
      return;
    }
    if (list.length === 0) {
      root.removeAttribute(RECENT_ATTR);
    } else {
      root.setAttribute(RECENT_ATTR, '');
    }
    const [rows, wide] = reservedRows(list.length);
    root.style.setProperty(RECENT_ROWS_VAR, String(rows));
    root.style.setProperty(RECENT_ROWS_WIDE_VAR, String(wide));
  };

  const read = (): RecentNote[] => {
    const raw = rawValue();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parseRecent(raw, env.now());
    }
    return cached;
  };

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const write = (list: RecentNote[]) => {
    const kept = list.slice(0, RECENT_MAX);
    try {
      const storage = env.storage();
      if (kept.length === 0) {
        storage.removeItem(RECENT_KEY);
      } else {
        storage.setItem(RECENT_KEY, JSON.stringify(kept));
      }
    } catch {
      // Denied or full: the list is a convenience, never an error.
    }
    hint(read());
    notify();
  };

  const updateTitle = (id: string, firstLine: string, rest: string) => {
    const list = read();
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const entry = list[index]!;
    const title = titleOf(firstLine);
    const excerpt = clip(rest, EXCERPT_MAX);
    if (entry.title === title && entry.excerpt === excerpt) {
      return;
    }
    write(list.with(index, { ...entry, title, excerpt }));
  };

  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === RECENT_KEY || key === null) {
      hint(read());
      notify();
    }
  };

  return {
    read,
    recordOpen(id, options = {}) {
      if (!isNoteId(id)) {
        return;
      }
      const list = read();
      const known = list.find((entry) => entry.id === id);
      const example = options.example === true || known?.example === true;
      const entry: RecentNote = {
        id,
        title: known?.title ?? UNTITLED,
        excerpt: known?.excerpt ?? '',
        openedAt: env.now(),
        ...(example ? { example: true as const } : {}),
      };
      write([entry, ...list.filter((other) => other.id !== id)]);
    },
    updateTitle,
    remove(id) {
      const list = read();
      if (list.some((entry) => entry.id === id)) {
        write(list.filter((entry) => entry.id !== id));
      }
    },
    clear() {
      write([]);
    },
    subscribe(onChange) {
      listeners.add(onChange);
      if (listeners.size === 1) {
        env.events?.addEventListener('storage', onStorage);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          env.events?.removeEventListener('storage', onStorage);
        }
      };
    },
    titleRecorder(id, intervalMs = TITLE_THROTTLE_MS) {
      let pending: [string, string] | null = null;
      let lastWrite = -Infinity;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (pending !== null) {
          const [firstLine, rest] = pending;
          pending = null;
          lastWrite = env.now();
          updateTitle(id, firstLine, rest);
        }
      };
      return {
        update(firstLine, rest) {
          pending = [firstLine, rest];
          if (timer !== null) {
            return;
          }
          const wait = lastWrite + intervalMs - env.now();
          if (wait <= 0) {
            flush();
          } else {
            timer = setTimeout(flush, wait);
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
