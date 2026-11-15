import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { createYDoc, YCollabExtension } from '@lexical/y';
import { attachYOfflineSession, recoverYOfflineEdits } from '@lexical/y/offline';
import * as Y from '@y/y';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../../shared/schema';
import { jotEditorExtension } from './extensions';
import {
  CAPTURE_MAX_AGE_MS,
  captureLegacyCopy,
  holdsNothingNew,
  OFFLINE_CONFIG,
  offlineStore,
  prepareNote,
  pruneCaptures,
  resetOfflineStore,
} from './offline';

const ID = 'AAAAAAAAAAAAAAAAAAAAAA';

/** Web Locks for Node: enough of the API for the store to tell live tabs. */
function fakeLocks() {
  const held = new Map<string, number>();
  return {
    async request(name: string, callback: (lock: unknown) => Promise<unknown>) {
      held.set(name, (held.get(name) ?? 0) + 1);
      try {
        return await callback({ name });
      } finally {
        const n = (held.get(name) ?? 1) - 1;
        if (n === 0) {
          held.delete(name);
        } else {
          held.set(name, n);
        }
      }
    },
    query() {
      return Promise.resolve({ held: [...held.keys()].map((name) => ({ name })) });
    },
  };
}

/** A fresh IndexedDB, and Web Locks, for each test. */
function idb() {
  return { indexedDB: new IDBFactory(), IDBKeyRange, locks: fakeLocks() };
}

/** A note editor bound to `doc` as the page binds it (YCollabExtension, jot's nodes). */
function bound(doc: ReturnType<typeof createYDoc>) {
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/offline',
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, { doc, schemaVersion: SCHEMA_VERSION, synced: true }),
      ],
      onWarn: () => {},
    }),
  );
  const collab = getExtensionDependencyFromEditor(editor, YCollabExtension).output.collab;
  return { editor, collab };
}

function type(editor: ReturnType<typeof bound>['editor'], text: string) {
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true },
  );
}

afterEach(() => resetOfflineStore());

describe('the store (D37)', () => {
  it('runs without one where the browser has no IndexedDB', async () => {
    const opened = await offlineStore({ indexedDB: undefined, IDBKeyRange: undefined });
    expect(opened.store).toBeNull();
    expect(opened.problem).toMatch(/IndexedDB/);
    const prepared = await prepareNote(ID);
    expect(prepared).toMatchObject({ store: null, loaded: null });
  });

  it('reads nothing for a note this device never stored', async () => {
    const prepared = await prepareNote(ID, idb());
    expect(prepared.store).not.toBeNull();
    expect(prepared.loaded).toBeNull();
  });
});

describe('a note page with edits the server has not taken', () => {
  it('stores them under the note and its generation, and a reload starts from them', async () => {
    const { store } = await offlineStore(idb());
    const doc = createYDoc();
    const { editor, collab } = bound(doc);
    const session = attachYOfflineSession({
      binding: collab,
      store,
      key: ID,
      epoch: null,
      stage: 'replay',
      keep: 'unsynced',
      onError: (error) => {
        throw new Error(error.message);
      },
    });
    expect((await session.serverEpoch('g1:first')).kind).toBe('same');
    session.markSynced();
    type(editor, 'Typed offline');
    await session.flush();
    expect(session.hasUnsyncedEdits).toBe(true);
    session.dispose();
    editor.dispose();

    const prepared = await prepareNote(ID);
    expect(prepared.loaded).toMatchObject({ epoch: 'g1:first', hasUnsyncedEdits: true });
    const reloaded = createYDoc(prepared.loaded!.state);
    expect(JSON.stringify(reloaded.get('lexical-y').toJSON())).toContain('Typed offline');
  });

  it('leaves a tab still open its rows: another page does not start from them', async () => {
    const { store } = await offlineStore(idb());
    const { editor, collab } = bound(createYDoc());
    const session = attachYOfflineSession({
      binding: collab,
      store,
      key: ID,
      epoch: 'g1:first',
      stage: 'replay',
      keep: 'unsynced',
      onError: () => {},
    });
    type(editor, 'Still open, offline');
    await session.flush();
    // The tab is open: its rows are its own.
    expect((await prepareNote(ID)).loaded).toBeNull();
    // Once it is gone (a reload, a closed tab), the next page starts from them.
    session.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = await prepareNote(ID);
    expect(after.loaded).toMatchObject({ epoch: 'g1:first', hasUnsyncedEdits: true });
    editor.dispose();
  });

  it('stores nothing once the server holds everything (keep: unsynced)', async () => {
    const { store } = await offlineStore(idb());
    const doc = createYDoc();
    const { editor, collab } = bound(doc);
    const session = attachYOfflineSession({
      binding: collab,
      store,
      key: ID,
      epoch: 'g1:first',
      stage: 'replay',
      keep: 'unsynced',
      onError: () => {},
    });
    type(editor, 'Sent');
    await session.flush();
    session.markSynced();
    await session.flush();
    expect(session.hasUnsyncedEdits).toBe(false);
    session.dispose();
    editor.dispose();
    expect((await prepareNote(ID)).loaded).toBeNull();
  });

  it('captures them when the note moved on, and the fresh page lists them with jot’s nodes', async () => {
    const { store } = await offlineStore(idb());
    // The note as the server held it (generation g1), and this page's copy of it.
    const server = createYDoc();
    const first = bound(server);
    type(first.editor, 'Shared start');
    const old = createYDoc(Y.encodeStateAsUpdate(server));
    const page = bound(old);
    const session = attachYOfflineSession({
      binding: page.collab,
      store,
      key: ID,
      epoch: 'g1:first',
      stage: 'replay',
      keep: 'unsynced',
      onError: () => {},
    });
    session.markSynced();
    type(page.editor, 'Written offline');
    await session.flush();

    // The note migrated meanwhile (a new generation): the page's verdict is stale.
    const moved = await session.serverEpoch('g1:second', { reason: 'stale' });
    expect(moved.kind).toBe('moved');
    expect(moved.kind === 'moved' && moved.saved.ok).toBe(true);
    expect(page.collab.status.kind).toBe('readonly');

    // The fresh page: the note as it is now, then what this device kept.
    const fresh = bound(createYDoc(Y.encodeStateAsUpdate(server)));
    const freshSession = attachYOfflineSession({
      binding: fresh.collab,
      store,
      key: ID,
      epoch: 'g1:second',
      stage: 'replay',
      keep: 'unsynced',
      onError: () => {},
    });
    const recovered = await recoverYOfflineEdits({
      binding: fresh.collab,
      store,
      key: ID,
      epoch: 'g1:second',
      stage: 'replay',
      config: OFFLINE_CONFIG,
      session: freshSession,
    });
    expect(recovered.ok).toBe(true);
    const [entry] = recovered.ok ? recovered.value : [];
    expect(entry!.capture.reason).toBe('stale');
    expect(entry!.report.ok).toBe(true);
    const report = entry!.report.ok ? entry!.report.value : null;
    expect(JSON.stringify(report!.fragment)).toContain('Written offline');
    // jot's blocks carry no ids: nothing is replayed, the panel offers Copy.
    expect(entry!.replay?.applied ?? []).toEqual([]);
    expect(JSON.stringify(fresh.editor.getEditorState().toJSON())).not.toContain('Written offline');
  });
});

describe('copies an earlier jot kept in localStorage (D18)', () => {
  it('become captures of their note on this device, never merged', async () => {
    const { store } = await offlineStore(idb());
    const doc = createYDoc();
    doc.get('lexical-y').insert(0, 'old copy');
    expect(await captureLegacyCopy(store, ID, Y.encodeStateAsUpdate(doc), 1000)).toBe(true);
    const captures = await store!.captures(ID);
    expect(captures.ok && captures.value.map((c) => [c.reason, c.epoch, c.base])).toEqual([
      ['legacy', null, null],
    ]);
    expect(await captureLegacyCopy(null, ID, Y.encodeStateAsUpdate(doc))).toBe(false);
  });
});

describe('a capture behind the note', () => {
  it('holds nothing new when the note has every item and deletion it has', async () => {
    const note = createYDoc();
    note.get('lexical-y').insert(0, 'Hello world');
    const copy = Y.encodeStateAsUpdate(note);
    note.get('lexical-y').insert(11, ' again');
    expect(holdsNothingNew(copy, note)).toBe(true);
    // An item the note lacks, and a deletion it lacks, are new.
    const ahead = createYDoc(copy);
    ahead.get('lexical-y').insert(0, '!');
    expect(holdsNothingNew(Y.encodeStateAsUpdate(ahead), note)).toBe(false);
    const deleted = createYDoc(copy);
    deleted.get('lexical-y').delete(0, 5);
    expect(holdsNothingNew(Y.encodeStateAsUpdate(deleted), note)).toBe(false);
  });
});

describe('pruning', () => {
  it('removes captures past 90 days and keeps the rest', async () => {
    const { store } = await offlineStore(idb());
    const state = Y.encodeStateAsUpdate(createYDoc());
    const now = 10 * CAPTURE_MAX_AGE_MS;
    await captureLegacyCopy(store, ID, state, now - CAPTURE_MAX_AGE_MS - 1);
    await captureLegacyCopy(store, ID, state, now - 1000);
    await pruneCaptures(store!, ID, now);
    const captures = await store!.captures(ID);
    expect(captures.ok && captures.value.map((c) => c.capturedAt)).toEqual([now - 1000]);
  });
});
