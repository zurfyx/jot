/**
 * Unsent edits on this device (D37), through `@lexical/y/offline`: one
 * IndexedDB store per page, a slot per note keyed by its id and the
 * generation (epoch) its document belongs to, holding only what the server
 * has not taken (`keep: 'unsynced'`). A page reloaded or a tab closed with
 * edits waiting starts from them; a note that moved on meanwhile (a
 * migration, or a note created again under its link) gets them as a
 * capture on this device, listed under ⋯ → Offline edits.
 */
import type { HeadlessYConfig } from '@lexical/y/headless';
import {
  openYOfflineStore,
  wrapLeftoversAsQuote,
  type YAutoReplay,
  type YLeftovers,
  type YOfflineCapture,
  type YOfflineLoaded,
  type YOfflineLocks,
  type YOfflineStage,
  type YOfflineStore,
} from '@lexical/y/offline';

import * as Y from '@y/y';

import { jotNodesExtension } from '../../shared/nodes';
import { SCHEMA_VERSION } from '../../shared/schema';

/**
 * The rollout stage: `replay`. A note's fresh page reapplies what this
 * device captured (D37): blocks only the person changed are written over the
 * note, matched by block id (D38); the rest go in as leftovers.
 */
export const OFFLINE_STAGE: YOfflineStage = 'replay';

/** Which blocks a replay writes by itself: every replayable one (only the person changed it). */
export const OFFLINE_AUTO_REPLAY: YAutoReplay = 'replayable';

const LEFTOVER_TIME = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** The label above leftover blocks: when the edits were made. */
export function leftoversLabel(capturedAt: number): string {
  return `Offline edits that didn’t merge · ${LEFTOVER_TIME.format(capturedAt)}`;
}

/**
 * Blocks a replay cannot apply (someone changed them too, or they are gone)
 * go into the note after the block they conflict with: a bold label line,
 * then each block, a paragraph as a quote. Nothing typed is dropped, and the
 * person merges by hand.
 */
export const OFFLINE_LEFTOVERS: YLeftovers = {
  wrap: wrapLeftoversAsQuote((context) => leftoversLabel(context.capturedAt)),
  placement: 'after-block',
};

/** Captures older than this are removed from the device, as the note's own records are (D34). */
export const CAPTURE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Milliseconds the session waits for typing to pause before it writes: none,
 * so a reload or a closed tab right after a keystroke keeps it (updates that
 * arrive while a write is in flight go in one row).
 */
export const OFFLINE_WRITE_DELAY_MS = 0;

/** How the reports read a capture: jot's node set, no DOM (`readYState`). */
export const OFFLINE_CONFIG: HeadlessYConfig = {
  extensions: [jotNodesExtension],
  schemaVersion: SCHEMA_VERSION,
};

export interface OfflineStore {
  /** Null when this browser has none (it says why in `problem`): the page runs at stage `off`. */
  store: YOfflineStore | null;
  problem: string | null;
}

/** What a note page reads from the device before it builds its document. */
export interface PreparedNote extends OfflineStore {
  /** The newest slot stored for the note, or null. */
  loaded: YOfflineLoaded | null;
}

export interface IdbGlobals {
  indexedDB: IDBFactory | undefined;
  IDBKeyRange: typeof IDBKeyRange | undefined;
  /** Tests only: Web Locks of their own (the page uses `navigator.locks`). */
  locks?: YOfflineLocks | null;
}

let opened: Promise<OfflineStore> | null = null;

/** The page's store, opened once. */
export function offlineStore(idb?: IdbGlobals): Promise<OfflineStore> {
  opened ??= openStore(
    idb ?? {
      indexedDB: globalThis.indexedDB as IDBFactory | undefined,
      IDBKeyRange: globalThis.IDBKeyRange as typeof IDBKeyRange | undefined,
    },
  );
  return opened;
}

/** Tests only: forget the page's store. */
export function resetOfflineStore(): void {
  opened = null;
}

async function openStore(idb: IdbGlobals): Promise<OfflineStore> {
  try {
    const { locks, ...globals } = idb;
    const result = await openYOfflineStore(
      locks === undefined ? { idb: globals } : { idb: globals, locks },
    );
    return result.ok
      ? { store: result.value, problem: null }
      : { store: null, problem: result.error.message };
  } catch (error) {
    return { store: null, problem: String(error) };
  }
}

/**
 * Reads what this device holds for note `id`: the newest slot with rows no
 * live tab holds (a page that reloaded, a tab that closed). Never rejects.
 *
 * `loadYOffline` would also take the rows of a tab still open on the note,
 * even one left at an earlier generation (offline across a migration): this
 * page would start from that tab's edits and capture them as its own. Those
 * rows stay that tab's; it captures them itself when it learns the note
 * moved on.
 */
export async function prepareNote(id: string, idb?: IdbGlobals): Promise<PreparedNote> {
  const { store, problem } = await offlineStore(idb);
  if (store === null) {
    return { store, problem, loaded: null };
  }
  try {
    const slots = await store.slots(id);
    if (!slots.ok) {
      return { store, problem: slots.error.message, loaded: null };
    }
    for (const info of slots.value) {
      const slot = store.slot(id, info.epoch);
      const read = await slot.load({ writers: 'gone' });
      if (!read.ok) {
        slot.close();
        return { store, problem: read.error.message, loaded: null };
      }
      if (read.value !== null) {
        const loaded: YOfflineLoaded = {
          epoch: info.epoch,
          state: read.value.state,
          base: read.value.base,
          baseAt: read.value.baseAt ?? null,
          hasUnsyncedEdits: read.value.hasUnsyncedEdits,
          slot,
        };
        return { store, problem: null, loaded };
      }
      slot.close();
    }
    return { store, problem: null, loaded: null };
  } catch (error) {
    return { store, problem: String(error), loaded: null };
  }
}

/**
 * Puts a copy an earlier jot kept in localStorage (D18) on this device as a
 * capture of its note, never merged into it. False when it could not be
 * stored (no store here): the caller keeps the copy.
 */
export async function captureLegacyCopy(
  store: YOfflineStore | null,
  id: string,
  state: Uint8Array,
  now = Date.now(),
): Promise<boolean> {
  if (store === null) {
    return false;
  }
  const capture: YOfflineCapture = {
    id: `legacy-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    key: id,
    epoch: null,
    reason: 'legacy',
    capturedAt: now,
    state,
    json: null,
    text: null,
    differs: false,
    base: null,
    claimed: false,
  };
  const result = await store.putCapture(capture);
  return result.ok;
}

/** Removes the note's captures older than {@link CAPTURE_MAX_AGE_MS}. */
export async function pruneCaptures(
  store: YOfflineStore,
  id: string,
  now = Date.now(),
): Promise<void> {
  const captures = await store.captures(id);
  if (!captures.ok) {
    return;
  }
  for (const capture of captures.value) {
    if (now - capture.capturedAt > CAPTURE_MAX_AGE_MS) {
      await store.deleteCapture(id, capture.id);
    }
  }
}

/**
 * Whether a capture holds nothing the note lacks: every item it has, and
 * every deletion, the note's document already holds (a copy behind the note,
 * or edits that did reach the server before it moved on). Such a capture is
 * not worth a look; the reports judge by blocks and would list any block that
 * changed since.
 */
export function holdsNothingNew(state: Uint8Array, current: Y.Doc): boolean {
  try {
    return Y.snapshotContainsUpdate(Y.snapshot(current), state);
  } catch {
    return false;
  }
}
