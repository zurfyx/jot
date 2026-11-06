import { runDurableObjectAlarm, runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { LAYOUT_VERSION, SEED_LAYOUT } from '@lexical/y';
import { seedYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';

import {
  encodeUpload,
  sha256Hex,
  UNKNOWN_GENERATION,
  type Upload,
  type UploadAcknowledgement,
  UPLOAD_HASH_HEADER,
} from '../shared/fence';
import { generateNoteId } from '../shared/ids';
import { jotNodesExtension } from '../shared/nodes';
import { FENCE_ADMIT, FENCE_BOOTSTRAP, FENCE_REFUSE_LAYOUT, FENCE_STALE } from '../shared/protocol';
import { SCHEMA_VERSION } from '../shared/schema';
import { PART_BYTES } from './quarantine';
import type { NoteRoom } from './room';
import { freshHandshake, TestClient } from './test-client';

function stubFor(id: string) {
  return env.NOTES.get(env.NOTES.idFromName(id));
}

function flush(id: string): Promise<void> {
  return runInDurableObject(stubFor(id), (room: NoteRoom) => room.save());
}

function identity(id: string) {
  return runInDurableObject(stubFor(id), (room: NoteRoom) => room.fenceIdentity);
}

function storedState(id: string): Promise<Uint8Array> {
  return runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
    const row = state.storage.sql.exec('SELECT state FROM note').one();
    return new Uint8Array(row.state as ArrayBuffer);
  });
}

function textOf(state: Uint8Array, root = 'text'): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.get(root).toString();
}

/** Writes a stored note row directly, as a note from before the fence. */
async function seedStoredNote(id: string, write: (doc: Y.Doc) => void): Promise<void> {
  const doc = new Y.Doc();
  write(doc);
  const state = Y.encodeStateAsUpdate(doc);
  await runInDurableObject(stubFor(id), (_room: NoteRoom, s) => {
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
  // The next visit loads it, as the first visit after the fence ships.
  await evictDurableObject(stubFor(id));
}

async function recoveryList(id: string) {
  const response = await exports.default.fetch(`http://jot.test/api/n/${id}/recovery`);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    records: {
      seq: number;
      kind: string;
      actionable: boolean;
      clients: number[];
      upload: string;
    }[];
  };
}

async function post(id: string, body: Uint8Array, hash?: string) {
  return exports.default.fetch(`http://jot.test/api/n/${id}/recovery`, {
    method: 'POST',
    headers: { [UPLOAD_HASH_HEADER]: hash ?? (await sha256Hex(body)) },
    body,
  });
}

function upload(snapshot: Uint8Array, overrides: Partial<Upload> = {}): Upload {
  return {
    session: 'test-session',
    replica: 'tab',
    source: {
      incarnation: null,
      generation: UNKNOWN_GENERATION,
      layouts: [1, 2],
      schemaVersion: SCHEMA_VERSION,
      renderer: 'jot',
    },
    snapshot,
    queue: [],
    draft: null,
    clients: [],
    peers: false,
    ...overrides,
  };
}

/** A note's state as jot's editor stores it, with one paragraph. */
function noteState(text: string): Uint8Array {
  return seedYState({ extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION }, () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  });
}

describe('incarnation', () => {
  it('is created at the first visit, not inherited for a new note, and kept across eviction', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    const room = await identity(id);
    expect(room).not.toBeNull();
    expect(room!.inherited).toBe(false);
    expect(room!.incarnation).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(room!.generation).toBe(
      `g1:${JSON.stringify([room!.incarnation, [['lexical-y', null]]])}`,
    );
    expect(room!.seedContract).toBe(SEED_LAYOUT);
    expect(a.fences).toEqual([
      { verdict: FENCE_BOOTSTRAP, generation: room!.generation, initialize: true },
    ]);
    a.type(0, 'kept');
    await flush(id);
    a.close();
    await evictDurableObject(stubFor(id));
    const b = await TestClient.connect(id);
    expect((await identity(id))!.incarnation).toBe(room!.incarnation);
    expect(b.text).toBe('kept');
    b.close();
  });

  it('is inherited by a note that existed before the fence', async () => {
    const id = generateNoteId();
    await seedStoredNote(id, (doc) => doc.get('text').insert(0, 'from before'));
    const a = await TestClient.connect(id);
    const room = await identity(id);
    expect(room!.inherited).toBe(true);
    expect(a.text).toBe('from before');
    a.close();
  });

  it('is new after the expiry alarm, so a copy of the earlier note is stale', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'first life');
    await flush(id);
    const first = (await identity(id))!;
    a.close();
    await a.until(() => a.closed !== null);
    await runDurableObjectAlarm(stubFor(id));
    // A tab that held the first note's text comes back with its edits.
    const back = await TestClient.connect(id, {
      handshake: freshHandshake({ generation: first.generation, material: true }),
      waitSync: false,
      prepare: (doc) => doc.get('text').insert(0, 'first life, edited offline'),
    });
    await back.until(() => back.fences.length > 0);
    const second = (await identity(id))!;
    expect(second.incarnation).not.toBe(first.incarnation);
    expect(second.inherited).toBe(false);
    expect(back.fences[0]!.verdict).toBe(FENCE_STALE);
    back.close();
  });
});

describe('handshake verdicts', () => {
  it('admits a replica presenting the room generation, bootstraps a fresh one', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'hello');
    const generation = a.fences[0]!.generation;
    const b = await TestClient.connect(id, {
      handshake: freshHandshake({ generation, material: true }),
    });
    expect(b.fences[0]).toEqual({ verdict: FENCE_ADMIT, generation, initialize: true });
    await b.until(() => b.text === 'hello');
    a.close();
    b.close();
  });

  it('hands off before any refusal: material plus another generation, an unreadable layout or a seed mismatch is stale', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.doc.get('lexical-y').setAttr('lexical-y:1', true);
    a.type(0, 'room text');
    await flush(id);
    const cases = [
      freshHandshake({ generation: UNKNOWN_GENERATION, material: true }),
      freshHandshake({ generation: 'other/-', material: true }),
      freshHandshake({ generation: null, material: true }),
      freshHandshake({
        generation: a.fences[0]!.generation,
        material: true,
        layouts: [LAYOUT_VERSION + 1, LAYOUT_VERSION + 1],
      }),
    ];
    for (const handshake of cases) {
      const c = await TestClient.connect(id, { handshake, waitSync: false });
      await c.until(() => c.fences.length > 0);
      expect(c.fences[0]!.verdict).toBe(FENCE_STALE);
      c.close();
    }
    const refused = await TestClient.connect(id, {
      handshake: freshHandshake({ layouts: [LAYOUT_VERSION + 1, LAYOUT_VERSION + 1] }),
      waitSync: false,
    });
    await refused.until(() => refused.fences.length > 0);
    expect(refused.fences[0]!.verdict).toBe(FENCE_REFUSE_LAYOUT);
    // Fenced sockets get nothing of the room: no sync payload at all.
    expect(refused.received).toEqual([]);
    refused.close();
    a.close();
  });

  it('refuses a fresh replica with another seed layout in a pristine room, and fences one with material', async () => {
    const id = generateNoteId();
    const seed = SEED_LAYOUT + 2;
    const fresh = await TestClient.connect(id, {
      handshake: freshHandshake({ seed }),
      waitSync: false,
    });
    await fresh.until(() => fresh.fences.length > 0);
    expect(fresh.fences[0]!.verdict).toBe(FENCE_REFUSE_LAYOUT);
    const held = await TestClient.connect(id, {
      handshake: freshHandshake({ seed, material: true }),
      waitSync: false,
      prepare: (doc) => doc.get('text').insert(0, 'seeded elsewhere'),
    });
    await held.until(() => held.fences.length > 0);
    expect(held.fences[0]!.verdict).toBe(FENCE_STALE);
    fresh.close();
    held.close();
  });

  it('rejects a malformed handshake with 400', async () => {
    const id = generateNoteId();
    const response = await exports.default.fetch(`http://jot.test/api/n/${id}/ws?f=1&m=2`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(400);
  });
});

describe('clients from before the fence', () => {
  it('are admitted as today on an inherited note that never migrated', async () => {
    const id = generateNoteId();
    await seedStoredNote(id, (doc) => doc.get('text').insert(0, 'old note'));
    const old = await TestClient.connect(id, { handshake: null });
    expect(old.fences).toEqual([]);
    expect(old.text).toBe('old note');
    old.type(8, ', still editable');
    const fresh = await TestClient.connect(id);
    await fresh.until(() => fresh.text === 'old note, still editable');
    old.close();
    fresh.close();
  });

  it('are captured on a new note: a standalone snapshot, then a signal built on it, never the room', async () => {
    for (const gc of [true, false]) {
      const id = generateNoteId();
      const a = await TestClient.connect(id);
      a.type(0, 'room text');
      await flush(id);
      const old = await TestClient.connect(id, {
        handshake: null,
        waitSync: false,
        prepare: (doc) => {
          doc.gc = gc;
          const nested = new Y.Node('box');
          doc.get('text').insert(0, 'offline text');
          doc.get('boxes').insert(0, [nested]);
          nested.insert(0, 'nested offline');
          doc.get('text').delete(0, 1);
        },
      });
      await old.until(() => old.synced);
      // The client keeps its own text: the signal adds no deletion.
      expect(old.text).toBe('ffline text');
      expect(old.doc.get('lexical-y').getAttr(`lexical-y-schema:${SCHEMA_VERSION + 1}`)).toBe(true);
      // What it received: the signal (one root attribute), then an empty step 2.
      const scratch = new Y.Doc();
      for (const payload of old.received) {
        Y.applyUpdate(scratch, payload);
      }
      expect(scratch.get('text').toString()).toBe('');
      expect(Object.keys(scratch.get('lexical-y').getAttrs())).toEqual([
        `lexical-y-schema:${SCHEMA_VERSION + 1}`,
      ]);
      // The room is untouched, and the capture is listed as holding new edits.
      old.type(0, 'o');
      await old.until(() => old.received.length >= 2);
      await flush(id);
      expect(textOf(await storedState(id))).toBe('room text');
      const { records } = await recoveryList(id);
      expect(records).toHaveLength(1);
      expect(records[0]!.kind).toBe('capture');
      expect(records[0]!.actionable).toBe(true);
      expect(records[0]!.clients).toContain(old.doc.clientID);
      const render = await exports.default.fetch(
        `http://jot.test/api/n/${id}/recovery/${records[0]!.seq}/raw`,
      );
      expect(render.status).toBe(200);
      expect((await render.arrayBuffer()).byteLength).toBeGreaterThan(0);
      a.close();
      old.close();
    }
  });

  it('keep editing nothing once the room moved on: updates from an admitted socket of an old generation are kept, not applied', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'before');
    await flush(id);
    // The room's generation moves on (as a migration does in a later release).
    await runInDurableObject(stubFor(id), (room: NoteRoom) => {
      const r = room as unknown as { room: { generation: string } };
      r.room = { ...r.room, generation: `${r.room.generation}x` };
    });
    a.type(6, ' after');
    // Wait for the update to arrive (a fixed sleep raced it under load).
    let records: { kind: string }[] = [];
    for (let i = 0; i < 50 && records.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      records = (await recoveryList(id)).records;
    }
    await flush(id);
    expect(textOf(await storedState(id))).toBe('before');
    expect(records.map((r) => r.kind)).toEqual(['capture']);
    a.close();
  });
});

describe('recovery uploads', () => {
  it('acknowledge after the write, once per upload, and survive eviction', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'room');
    await flush(id);
    const body = encodeUpload(upload(noteState('offline paragraph')));
    const bad = await post(id, body, '00');
    expect(bad.status).toBe(400);
    // An unread body keeps the request open, and eviction waits for it.
    await bad.text();
    const first = await post(id, body);
    expect(first.status).toBe(200);
    const ack = (await first.json()) as UploadAcknowledgement;
    // The durable acknowledgement, scoped (YRecordAcknowledgement, version 1).
    expect(ack).toMatchObject({
      v: 1,
      room: id,
      replica: 'tab',
      sourceGeneration: UNKNOWN_GENERATION,
      upload: await sha256Hex(body),
      actionable: true,
    });
    expect(ack.hash).toMatch(/^yr1-sha256:[0-9a-f]{64}$/);
    expect(ack.record).toBe(ack.hash);
    const again = (await (await post(id, body)).json()) as UploadAcknowledgement;
    expect(again).toEqual(ack);
    await evictDurableObject(stubFor(id));
    const { records } = await recoveryList(id);
    expect(records.map((r) => r.seq)).toEqual([ack.seq]);
    expect(records[0]!.upload).toBe(ack.upload);
    const view = await exports.default.fetch(
      `http://jot.test/api/n/${id}/recovery/${ack.seq}/view`,
    );
    expect(view.headers.get('x-jot-complete')).toBe('1');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(await view.arrayBuffer()));
    expect(JSON.stringify(doc.get('lexical-y').toJSON())).toContain('offline paragraph');
    a.close();
  });

  it('store material over the row cap in parts and give it back whole', async () => {
    const id = generateNoteId();
    const doc = new Y.Doc();
    let big = '';
    for (let i = 0; i < 2_600_000; i++) {
      big += String.fromCharCode(97 + ((i * 7919) % 26));
    }
    doc.get('text').insert(0, big);
    const snapshot = Y.encodeStateAsUpdate(doc);
    expect(snapshot.byteLength).toBeGreaterThan(PART_BYTES);
    const response = await post(id, encodeUpload(upload(snapshot)));
    expect(response.status).toBe(200);
    const { seq } = (await response.json()) as { seq: number };
    const chunks = await runInDurableObject(
      stubFor(id),
      (_room: NoteRoom, s) =>
        s.storage.sql.exec('SELECT COUNT(*) AS n FROM record_parts WHERE seq = ?', seq).one().n,
    );
    expect(chunks).toBe(2);
    const raw = new Uint8Array(
      await (
        await exports.default.fetch(`http://jot.test/api/n/${id}/recovery/${seq}/raw`)
      ).arrayBuffer(),
    );
    expect(raw.byteLength).toBeGreaterThan(snapshot.byteLength);
  });

  it('judge a copy behind the note, not refuse it (MG-jot-1)', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'Hello');
    const behind = Y.encodeStateAsUpdate(a.doc);
    a.type(5, ' again');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flush(id);
    const same = await post(id, encodeUpload(upload(behind)));
    expect(same.status).toBe(200);
    expect(((await same.json()) as { actionable: boolean }).actionable).toBe(false);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, behind);
    replica.get('text').delete(0, 1);
    const deleted = await post(id, encodeUpload(upload(Y.encodeStateAsUpdate(replica))));
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as { actionable: boolean }).actionable).toBe(true);
    a.close();
  });

  it('refuse malformed and oversized uploads', async () => {
    const id = generateNoteId();
    const malformed = await post(id, new Uint8Array([1, 2, 3]));
    expect(malformed.status).toBe(400);
    await malformed.text();
    const huge = new Uint8Array(8_000_001);
    const response = await exports.default.fetch(`http://jot.test/api/n/${id}/recovery`, {
      method: 'POST',
      headers: { [UPLOAD_HASH_HEADER]: await sha256Hex(huge) },
      body: huge,
    });
    expect(response.status).toBe(413);
    await response.text();
  });
});
