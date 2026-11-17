import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { createYDoc, YCollabExtension } from '@lexical/y';
import { readYState } from '@lexical/y/headless';
import {
  attachYOfflineSession,
  recoverYOfflineEdits,
  type YOfflineSession,
} from '@lexical/y/offline';
import * as Y from '@y/y';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  UNDO_COMMAND,
  configExtension,
  defineExtension,
} from 'lexical';
import { $createCodeNode } from '@lexical/code-core';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { afterEach, describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../../shared/schema';
import { jotEditorExtension } from './extensions';
import { shownCaptures } from './recovery/Recovery';
import {
  CAPTURE_MAX_AGE_MS,
  captureLegacyCopy,
  holdsNothingNew,
  OFFLINE_AUTO_REPLAY,
  OFFLINE_CONFIG,
  OFFLINE_LEFTOVERS,
  OFFLINE_STAGE,
  leftoversLabel,
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
        configExtension(YCollabExtension, {
          doc,
          onYStatus: null,
          schemaVersion: SCHEMA_VERSION,
          synced: true,
        }),
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

/** The note's generation is confirmed ('same'), and the server holds everything: mark it synced. */
async function markSynced(session: YOfflineSession, epoch: string) {
  const verdict = await session.serverEpoch(epoch);
  expect(verdict.kind).toBe('same');
  if (verdict.kind === 'same') {
    verdict.markSynced();
  }
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
      key: ID,
      epoch: null,
      loaded: null,
      offline: { stage: OFFLINE_STAGE, store: store!, persist: 'unsynced' },
      stopSync: () => {},
      onError: (error) => {
        throw new Error(error.message);
      },
    });
    await markSynced(session, 'g1:first');
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
      key: ID,
      epoch: 'g1:first',
      loaded: null,
      offline: { stage: OFFLINE_STAGE, store: store!, persist: 'unsynced' },
      stopSync: () => {},
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
      key: ID,
      epoch: 'g1:first',
      loaded: null,
      offline: { stage: OFFLINE_STAGE, store: store!, persist: 'unsynced' },
      stopSync: () => {},
      onError: () => {},
    });
    type(editor, 'Sent');
    await session.flush();
    await markSynced(session, 'g1:first');
    await session.flush();
    expect(session.hasUnsyncedEdits).toBe(false);
    session.dispose();
    editor.dispose();
    expect((await prepareNote(ID)).loaded).toBeNull();
  });

  /**
   * A page synced at g1 makes `offline` edits; meanwhile the note moves to g2
   * with `meanwhile` applied; the page's verdict is stale, so it captures; a
   * fresh page at g2 recovers.
   */
  async function movedOn(
    offline: (editor: ReturnType<typeof bound>['editor']) => void,
    meanwhile: (editor: ReturnType<typeof bound>['editor']) => void = () => {},
    before: (editor: ReturnType<typeof bound>['editor']) => void = () => {},
  ) {
    const { store } = await offlineStore(idb());
    const server = createYDoc();
    const first = bound(server);
    type(first.editor, 'Shared start');
    type(first.editor, 'Second line');
    before(first.editor);
    const page = bound(createYDoc(Y.encodeStateAsUpdate(server)));
    const session = attachYOfflineSession({
      binding: page.collab,
      key: ID,
      epoch: 'g1:first',
      loaded: null,
      offline: { stage: OFFLINE_STAGE, store: store!, persist: 'unsynced' },
      stopSync: () => {},
      onError: () => {},
    });
    await markSynced(session, 'g1:first');
    offline(page.editor);
    await session.flush();
    meanwhile(first.editor);
    const moved = await session.serverEpoch('g1:second', { reason: 'stale' });
    expect(moved.kind).toBe('moved');
    expect(moved.kind === 'moved' && moved.saved.ok).toBe(true);
    expect(page.collab.status.kind).toBe('readonly');

    const freshDoc = createYDoc(Y.encodeStateAsUpdate(server));
    const fresh = bound(freshDoc);
    const freshSession = attachYOfflineSession({
      binding: fresh.collab,
      key: ID,
      epoch: 'g1:second',
      loaded: null,
      offline: { stage: OFFLINE_STAGE, store: store!, persist: 'unsynced' },
      stopSync: () => {},
      onError: () => {},
    });
    const recovered = await recoverYOfflineEdits({
      binding: fresh.collab,
      store,
      key: ID,
      epoch: 'g1:second',
      stage: OFFLINE_STAGE,
      autoReplay: OFFLINE_AUTO_REPLAY,
      leftovers: OFFLINE_LEFTOVERS,
      config: OFFLINE_CONFIG,
      session: freshSession,
    });
    expect(recovered.ok).toBe(true);
    const entries = recovered.ok ? recovered.value : [];
    // The note's lines, past the empty paragraph a new note starts with.
    const lines = fresh.editor.read(() =>
      $getRoot()
        .getChildren()
        .slice(1)
        .map((node) => `${node.getType()}: ${node.getTextContent()}`),
    );
    // What the binding stored: a fresh read of the document, as the server and
    // every other client see it. The replay and the leftovers must be in it.
    const stored = readYState(Y.encodeStateAsUpdate(freshDoc), OFFLINE_CONFIG, () =>
      $getRoot()
        .getChildren()
        .slice(1)
        .map((node) => `${node.getType()}: ${node.getTextContent()}`),
    );
    expect(stored).toEqual(lines);
    return { entries, lines, fresh };
  }

  const editLine = (index: number, text: string) => (editor: ReturnType<typeof bound>['editor']) =>
    editor.update(
      () => {
        const line = $getRoot().getChildAtIndex(index) as ElementNode;
        line.getLastDescendant()!.insertAfter($createTextNode(text));
      },
      { discrete: true },
    );

  it('replays what only this device changed into the note that moved on, by block id', async () => {
    const { entries, lines } = await movedOn((editor) => type(editor, 'Written offline'));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.capture.reason).toBe('stale');
    // The added block went in, after the block before it, as one replay.
    expect(entries[0]!.replay?.applied).toHaveLength(1);
    expect(entries[0]!.replay?.inserted).toEqual([]);
    expect(lines).toEqual([
      'paragraph: Shared start',
      'paragraph: Second line',
      'paragraph: Written offline',
    ]);
    expect(entries[0]!.capture.resolved).toBeDefined();
    expect(shownCaptures(entries)).toEqual([]);
  });

  it('writes a block both sides changed after the note’s version, under the leftovers label', async () => {
    const { entries, lines } = await movedOn(
      editLine(1, ' (mine, offline)'),
      editLine(1, ' (theirs, meanwhile)'),
    );
    const replay = entries[0]!.replay!;
    expect(replay.applied).toEqual([]);
    expect(replay.leftovers).toHaveLength(1);
    // The note keeps its version; the person's follows it, labelled, as a quote.
    expect(lines).toEqual([
      'paragraph: Shared start (theirs, meanwhile)',
      expect.stringMatching(/^paragraph: Offline edits that didn’t merge · /),
      'quote: Shared start (mine, offline)',
      'paragraph: Second line',
    ]);
    expect(shownCaptures(entries)).toEqual([]);
  });

  /** Appends `text` to the last text of the note's last block. */
  const editLast = (editor: ReturnType<typeof bound>['editor'], text: string) =>
    editor.update(
      () => {
        const last = $getRoot().getLastChild() as ElementNode;
        last.getLastDescendant()!.insertAfter($createTextNode(text));
      },
      { discrete: true },
    );

  it.each([
    [
      'a list item',
      () => $createListNode('bullet').append($createListItemNode().append($createTextNode('Item'))),
    ],
    ['a heading', () => $createHeadingNode('h2').append($createTextNode('Heading'))],
    ['a code block', () => $createCodeNode().append($createTextNode('let a = 1;'))],
    [
      'a check list item',
      () =>
        $createListNode('check').append($createListItemNode(false).append($createTextNode('Todo'))),
    ],
  ])(
    'stores the leftovers of %s both sides changed: nothing is lost on the way to the document',
    async (_, $make) => {
      const { entries, lines } = await movedOn(
        (editor) => editLast(editor, ' (mine)'),
        (editor) => editLast(editor, ' (theirs)'),
        (editor) => editor.update(() => $getRoot().append($make()), { discrete: true }),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]!.replay?.leftovers.length).toBe(1);
      // movedOn checked that the stored document reads as the editor shows it:
      // the person's version is in both, after the label, and theirs stays.
      expect(lines.some((line) => line.includes('(theirs)'))).toBe(true);
      expect(lines.some((line) => line.includes('(mine)'))).toBe(true);
      expect(lines.some((line) => line.includes('Offline edits that didn’t merge'))).toBe(true);
    },
  );

  it('reapplies as one step: one undo takes the leftovers out again', async () => {
    const { fresh } = await movedOn(
      editLine(1, ' (mine, offline)'),
      editLine(1, ' (theirs, meanwhile)'),
    );
    fresh.editor.dispatchCommand(UNDO_COMMAND, undefined);
    expect(
      fresh.editor.read(() =>
        $getRoot()
          .getChildren()
          .slice(1)
          .map((node) => `${node.getType()}: ${node.getTextContent()}`),
      ),
    ).toEqual(['paragraph: Shared start (theirs, meanwhile)', 'paragraph: Second line']);
  });
});

describe('the leftovers label', () => {
  it('says when the edits were made', () => {
    const at = new Date(2026, 10, 15, 14, 5).getTime();
    expect(leftoversLabel(at)).toMatch(/^Offline edits that didn’t merge · Nov 15, 2:05\s?PM$/);
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
