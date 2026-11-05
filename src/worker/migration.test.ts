import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { readYState } from '@lexical/y/headless';
import { prepareYRoom } from '@lexical/y/server';
import * as Y from '@y/y';
import { $getEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import { encodeUpload, sha256Hex, type Upload, UPLOAD_HASH_HEADER } from '../shared/fence';
import { generateNoteId } from '../shared/ids';
import { jotNodesExtension } from '../shared/nodes';
import { layout1Note } from '../shared/testing/layout1';
import { FENCE_REFUSE_LAYOUT, FENCE_STALE } from '../shared/protocol';
import { SCHEMA_VERSION } from '../shared/schema';
import { freshCopy } from './copy';
import type { NoteRoom } from './room';
import { LAYOUT_FLOOR, LAYOUT_STEPS } from './steps';
import { freshHandshake, TestClient } from './test-client';

/**
 * Release R+1 (D34): a note below the floor migrates on its first open, an
 * offline replica's edits are replayed at the note as a checked edit, and a
 * note whose migrated state passes the cap becomes a fresh document under a
 * new incarnation. Run with the 1to2 step and a per-note floor of 2, so the
 * whole path runs on the layouts of today.
 */

/**
 * A release R client (D34): it reads layouts 1 and 2 and seeds layout 1, so it
 * can open a note before its migration in any release, layout 3 included.
 */
function connectR(id: string) {
  return TestClient.connect(id, { handshake: freshHandshake({ layouts: [1, 2], seed: 1 }) });
}

function stubFor(id: string) {
  return env.NOTES.get(env.NOTES.idFromName(id));
}

/**
 * The layout the tests migrate to: the Worker's floor once a release raises it
 * (3 with identity's layout 3), else 2 through the test setting (the 1to2 step).
 */
const TARGET = Math.max(LAYOUT_FLOOR, 2);

/** Every layout the bundled steps reach from layout 1 (2, and 3 once `2to3` ships). */
const REACHABLE = LAYOUT_STEPS.map((step) => step.to);

/** The layout records and the epoch a note migrated from layout 1 to TARGET carries. */
const MIGRATED_LAYOUTS = [
  'lexical-y-epoch',
  ...Array.from({ length: TARGET }, (_, i) => `lexical-y:${i + 1}`),
].sort();

function rootOf(state: Uint8Array, gc = true): Y.Doc {
  const doc = new Y.Doc({ gc });
  doc.cleanupFormatting = false;
  Y.applyUpdate(doc, state);
  return doc;
}

function textOf(state: Uint8Array): string {
  return JSON.stringify(
    (rootOf(state).get('lexical-y').toJSON() as { children: unknown }).children,
  );
}

/** Inserts `text` into a note's root at `index` (lines are text, then a ¶ marker). */
function insertAt(doc: Y.Doc, index: number, text: string): void {
  doc.transact(() => doc.get('lexical-y').insert(index, text));
}

/** The length of the note's first line (the index of its first marker). */
function firstLineLength(doc: Y.Doc): number {
  return String((doc.get('lexical-y').toJSON() as { children: unknown[] }).children[0]).length;
}

function layoutsOf(state: Uint8Array): string[] {
  return Object.keys(rootOf(state).get('lexical-y').getAttrs())
    .filter((k) => k.startsWith('lexical-y:') || k === 'lexical-y-epoch')
    .sort();
}

/**
 * Writes a stored row, as a note saved by an earlier release, its floor held
 * at 1 until a test raises it (else a release whose floor is 3 migrates it at
 * the first visit).
 */
async function storeNote(id: string, state: Uint8Array): Promise<void> {
  await runInDurableObject(stubFor(id), (room: NoteRoom, s) => {
    room.testSettings({ floor: 1 });
    s.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS note (id INTEGER PRIMARY KEY CHECK (id = 0), name TEXT NOT NULL,
        state BLOB NOT NULL, saved_at INTEGER NOT NULL)`,
    );
    s.storage.sql.exec(
      'INSERT INTO note (id, name, state, saved_at) VALUES (0, ?, ?, ?)',
      id,
      state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
      Date.now(),
    );
  });
  await evictDurableObject(stubFor(id));
}

function stored(id: string): Promise<Uint8Array> {
  return runInDurableObject(stubFor(id), (_room: NoteRoom, s) => {
    const row = s.storage.sql.exec('SELECT state FROM note').one();
    return new Uint8Array(row.state as ArrayBuffer);
  });
}

function settings(id: string, values: { floor?: number; maxBytes?: number }): Promise<void> {
  return runInDurableObject(stubFor(id), (room: NoteRoom) => room.testSettings(values));
}

function identity(id: string) {
  return runInDurableObject(stubFor(id), (room: NoteRoom) => room.fenceIdentity);
}

function count(id: string, table: string): Promise<number> {
  return runInDurableObject(
    stubFor(id),
    (_room: NoteRoom, s) =>
      s.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n as number,
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);
}

function phase(id: string): Promise<string> {
  return runInDurableObject(
    stubFor(id),
    (_room: NoteRoom, s) => s.storage.sql.exec('SELECT phase FROM room').one().phase as string,
  );
}

function transitionKinds(id: string): Promise<string[]> {
  return runInDurableObject(stubFor(id), (_room: NoteRoom, s) =>
    s.storage.sql
      .exec<{ kind: string }>('SELECT kind FROM transitions ORDER BY seq')
      .toArray()
      .map((r) => r.kind),
  );
}

async function upload(id: string, body: Upload) {
  const bytes = encodeUpload(body);
  const response = await exports.default.fetch(`http://jot.test/api/n/${id}/recovery`, {
    method: 'POST',
    headers: { [UPLOAD_HASH_HEADER]: await sha256Hex(bytes) },
    body: bytes,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    seq: number;
    actionable: boolean;
    replay: { applied: number; conflicts: number } | null;
  };
}

function handoff(snapshot: Uint8Array, generation: string, clients: number[]): Upload {
  return {
    session: 'tab',
    replica: 'tab',
    source: {
      incarnation: null,
      generation,
      layouts: [1, 2],
      schemaVersion: SCHEMA_VERSION,
      renderer: 'jot',
    },
    snapshot,
    queue: [],
    draft: null,
    clients,
    peers: false,
  };
}

/** A replica of `state` that typed `text` at the end of its first paragraph, offline. */
function offlineEdit(state: Uint8Array, text: string, gc: boolean, client = 777001) {
  const doc = rootOf(state, gc);
  doc.clientID = client;
  insertAt(doc, firstLineLength(doc), text);
  return { snapshot: Y.encodeStateAsUpdate(doc), client: doc.clientID };
}

describe(`migration on first open (to layout ${TARGET})`, () => {
  it('migrates a layout 1 note in place before serving, keeps its base, and does it once', async () => {
    const id = generateNoteId();
    const before = layout1Note('twoLines');
    await storeNote(id, before);
    await settings(id, { floor: TARGET });
    await evictDurableObject(stubFor(id));
    const a = await TestClient.connect(id);
    const after = await stored(id);
    expect(layoutsOf(before)).toEqual(['lexical-y:1']);
    expect(layoutsOf(after)).toEqual(MIGRATED_LAYOUTS);
    expect(textOf(after)).toBe(textOf(before));
    const room = (await identity(id))!;
    // Its generation (g1) names the migration: the served root's epoch transition.
    expect(room.generation.startsWith('g1:')).toBe(true);
    expect(JSON.parse(room.generation.slice(3))).toEqual([
      room.incarnation,
      [['lexical-y', [expect.any(Number), expect.any(Number)]]],
    ]);
    expect(a.fences[0]!.generation).toBe(room.generation);
    expect(await count(id, 'bases')).toBe(1);
    expect(await transitionKinds(id)).toEqual(['in-place']);
    a.close();
    await evictDurableObject(stubFor(id));
    const b = await TestClient.connect(id);
    expect(sameBytes(await stored(id), after)).toBe(true);
    expect(await transitionKinds(id)).toEqual(['in-place']);
    b.close();
  });

  it('seals the live document first: an update applied just before is in the migrated state', async () => {
    const id = generateNoteId();
    await storeNote(id, layout1Note('shared'));
    const a = await connectR(id);
    insertAt(a.doc, firstLineLength(a.doc), ' just now');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settings(id, { floor: TARGET });
    const b = await TestClient.connect(id);
    await a.until(() => a.closed !== null);
    expect(a.closed!.code).toBe(4000);
    expect(textOf(await stored(id))).toContain('Shared start just now');
    expect(JSON.stringify(b.doc.get('lexical-y').toJSON())).toContain('Shared start just now');
    b.close();
  });

  it('refuses a stale replica at the old generation, which then hands off', async () => {
    const id = generateNoteId();
    const before = layout1Note('shared');
    await storeNote(id, before);
    const a = await connectR(id);
    const old = a.fences[0]!.generation;
    a.close();
    await settings(id, { floor: TARGET });
    const stale = await TestClient.connect(id, {
      handshake: freshHandshake({ generation: old, material: true }),
      waitSync: false,
    });
    await stale.until(() => stale.fences.length > 0);
    expect(stale.fences[0]!.verdict).toBe(FENCE_STALE);
    expect(stale.received).toEqual([]);
    stale.close();
  });

  it('is stuck, applying nothing, when a root cannot be migrated', async () => {
    const id = generateNoteId();
    const doc = rootOf(layout1Note('topic'));
    doc.get('lexical-y').setAttr('lexical-y-epoch', 'not an epoch');
    await storeNote(id, Y.encodeStateAsUpdate(doc));
    await settings(id, { floor: TARGET });
    const before = await stored(id);
    const a = await TestClient.connect(id, { waitSync: false });
    await a.until(() => a.fences.length > 0);
    // No client reads a root with a malformed epoch: refused, and nothing is written.
    expect(a.fences[0]!.verdict).toBe(FENCE_REFUSE_LAYOUT);
    expect(await phase(id)).toBe('stuck');
    expect(sameBytes(await stored(id), before)).toBe(true);
    expect(await transitionKinds(id)).toEqual([]);
    a.close();
  });
});

describe('the recovery view after a migration', () => {
  it('serves a layout 1 record migrated for rendering, never stored', async () => {
    const id = generateNoteId();
    const before = layout1Note('topic');
    await storeNote(id, before);
    await settings(id, { floor: TARGET });
    const a = await TestClient.connect(id);
    const offline = offlineEdit(before, ' kept', true);
    const { seq } = await upload(id, handoff(offline.snapshot, 'someone-else/-', [offline.client]));
    const view = await exports.default.fetch(`http://jot.test/api/n/${id}/recovery/${seq}/view`);
    expect(view.status).toBe(200);
    const state = new Uint8Array(await view.arrayBuffer());
    expect(layoutsOf(state)).toContain(`lexical-y:${TARGET}`);
    expect(textOf(state)).toContain('Topic kept');
    expect(await count(id, 'bases')).toBe(1);
    a.close();
  });
});

/** Every container's live items, in order (content kind and value), and its live attributes. */
function structure(state: Uint8Array): unknown {
  const doc = rootOf(state);
  const walk = (node: Y.Node): unknown => {
    const items: unknown[] = [];
    for (let it = node._start; it !== null; it = it.right) {
      if (it.deleted) {
        continue;
      }
      const c = it.content;
      if (c instanceof Y.ContentType) {
        items.push(['type', (c.type as Y.Node).name, walk(c.type as Y.Node)]);
      } else {
        // Per unit: item boundaries (merges, splits) are not content.
        for (const unit of c.getContent()) {
          items.push([c.constructor.name, unit]);
        }
      }
    }
    const attrs: Record<string, unknown> = {};
    for (const [key, it] of node._map) {
      if (!it.deleted) {
        const c = it.content;
        attrs[key] = c instanceof Y.ContentType ? walk(c.type as Y.Node) : c.getContent();
      }
    }
    return { items, attrs };
  };
  const out: Record<string, unknown> = {};
  for (const [name, type] of doc.share) {
    out[name] = walk(type as Y.Node);
  }
  return out;
}

describe('the fresh copy (Yjs only)', () => {
  it.each(REACHABLE)(
    'copies a note migrated to layout %i item for item, and it reads the same',
    (to) => {
      // A heading, a bold run, a link, a quote and a list; history: a deleted word; a people entry.
      const doc = rootOf(layout1Note('rich'));
      doc.transact(() => {
        doc.get('lexical-y').insert(5, 'gone ');
        doc.get('jot-people').setAttr('42', { p: 'person', n: 'Ana', c: 1, k: 'person', s: 1 });
      });
      doc.transact(() => doc.get('lexical-y').delete(5, 5));
      const prepared = prepareYRoom(Y.encodeStateAsUpdate(doc), {
        steps: LAYOUT_STEPS,
        incarnation: 'i',
        gc: true,
        to,
      });
      const copy = freshCopy(prepared.state);
      expect(structure(copy)).toEqual(structure(prepared.state));
      expect(copy.byteLength).toBeLessThanOrEqual(prepared.state.byteLength);
      // No id of the original survives.
      const original = new Set(Y.decodeUpdate(prepared.state).structs.map((s) => s.id.client));
      expect(Y.decodeUpdate(copy).structs.some((s) => original.has(s.id.client))).toBe(false);
      // Read through jot's editor at the layout this build reads.
      if (to === TARGET) {
        const config = { extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION };
        const read = (state: Uint8Array) =>
          readYState(state, config, () => $getEditor().getEditorState().toJSON());
        expect(read(copy)).toEqual(read(prepared.state));
      }
    },
  );
});

describe('the 2 MB fallback', () => {
  it('makes a fresh document under a new incarnation when the migrated state passes the cap', async () => {
    const id = generateNoteId();
    // Many clients' small edits: a state much larger than its content.
    const doc = rootOf(layout1Note('topic'));
    for (let i = 0; i < 400; i++) {
      doc.clientID = 900000 + i;
      insertAt(doc, i, 'ab');
      doc.transact(() => doc.get('lexical-y').delete(i + 1, 1));
    }
    const before = Y.encodeStateAsUpdate(doc);
    await storeNote(id, before);
    const first = await connectR(id);
    const old = (await identity(id))!;
    first.close();
    await settings(id, { floor: TARGET, maxBytes: Math.floor(before.byteLength * 0.8) });
    const a = await TestClient.connect(id);
    const room = (await identity(id))!;
    expect(room.incarnation).not.toBe(old.incarnation);
    expect(await transitionKinds(id)).toEqual(['fresh']);
    const note = await stored(id);
    expect(note.byteLength).toBeLessThan(before.byteLength * 0.8);
    expect(textOf(note)).toContain('a'.repeat(400));
    expect(layoutsOf(note)).toContain(`lexical-y:${TARGET}`);
    a.close();
  });
});
