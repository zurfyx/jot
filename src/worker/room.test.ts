import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { generateNoteId, noteSocketPath, PUBLIC_NOTE_ID } from '../shared/ids';
import { NOTE_EXPIRY_MS, NOTE_MAX_BYTES } from '../shared/limits';
import { CLOSE_MALFORMED } from '../shared/protocol';
import type { NoteRoom } from './room';
import { TestClient } from './test-client';

function stubFor(id: string) {
  return env.NOTES.get(env.NOTES.idFromName(id));
}

function storedRows(id: string): Promise<number> {
  return runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
    const tables = state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note'")
      .toArray();
    if (tables.length === 0) {
      return 0;
    }
    return state.storage.sql.exec('SELECT COUNT(*) AS n FROM note').one().n as number;
  });
}

function flush(id: string): Promise<void> {
  return runInDurableObject(stubFor(id), (room: NoteRoom) => room.save());
}

/** Random text: Yjs does not compress, so its encoded size tracks its length. */
function filler(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[(i * 7919 + (i >> 3)) % alphabet.length];
  }
  return out;
}

describe('routes', () => {
  it('rejects malformed ids with 400', async () => {
    for (const path of [
      '/api/n/nope/ws',
      '/api/n/AAAAAAAAAAAAAAAAAAAAAB/ws',
      '/n/nope',
      '/n/..%2Fadmin',
      '/n/AAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      const response = await exports.default.fetch(`http://jot.test${path}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(response.status, path).toBe(400);
    }
  });

  it('asks for an upgrade on a plain request to a socket', async () => {
    const response = await exports.default.fetch(
      `http://jot.test${noteSocketPath(generateNoteId())}`,
    );
    expect(response.status).toBe(426);
  });

  it('accepts the public note id', async () => {
    const client = await TestClient.connect(PUBLIC_NOTE_ID);
    expect(client.synced).toBe(true);
    client.close();
  });
});

describe('NoteRoom', () => {
  it('converges two clients', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    a.type(0, 'Hello');
    b.type(0, 'World ');
    await a.until(() => a.text.length === 11);
    await b.until(() => b.text.length === 11);
    expect(a.text).toBe(b.text);

    // A late joiner gets the merged document from the server.
    const c = await TestClient.connect(id);
    expect(c.text).toBe(a.text);
    for (const client of [a, b, c]) client.close();
  });

  it('relays awareness and announces a departure', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    const { encodeAwarenessUpdate } = await import('./awareness');
    const encoding = await import('lib0/encoding');
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate([{ clientID: 42, clock: 1, state: '{"user":{"name":"Ana"}}' }]),
    );
    a.send(encoding.toUint8Array(encoder));
    await b.until(() => b.awarenessMessages.length === 1);
    const seen = b.awarenessMessages.length;
    a.close();
    await b.until(() => b.awarenessMessages.length > seen);
    const { decodeAwarenessUpdate } = await import('./awareness');
    const removal = decodeAwarenessUpdate(b.awarenessMessages.at(-1)!);
    expect(removal).toEqual([{ clientID: 42, clock: 2, state: 'null' }]);
    b.close();
  });

  it('rejects an update that would push the note past the cap', async () => {
    const id = generateNoteId();
    const writer = await TestClient.connect(id);
    const reader = await TestClient.connect(id);
    writer.type(0, filler(950_000));
    await reader.until(() => reader.text.length === 950_000, 15_000);
    writer.type(950_000, filler(950_000));
    await reader.until(() => reader.text.length === 1_900_000, 15_000);

    writer.type(0, filler(200_000));
    await writer.until(() => writer.rejections === 1, 15_000);
    expect(writer.lastStatus?.rejected).toBe(true);
    expect(writer.lastStatus!.bytes).toBeLessThanOrEqual(NOTE_MAX_BYTES);

    // A small edit still fits, and the reader never saw the rejected one.
    reader.type(0, 'ok');
    await writer.until(() => writer.text.startsWith('ok') || writer.text.includes('ok'));
    expect(reader.text.length).toBe(1_900_002);
    await flush(id);
    const bytes = await runInDurableObject(stubFor(id), (room: NoteRoom) => room.storedBytes);
    expect(bytes).toBeLessThanOrEqual(NOTE_MAX_BYTES);
    writer.close();
    reader.close();
  });

  it('keeps the document across eviction, with sockets hibernated', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'survives');
    await a.until(() => a.text === 'survives');
    await flush(id);
    expect(await storedRows(id)).toBe(1);

    await evictDurableObject(stubFor(id));

    // The hibernated socket still works: the next message wakes the object,
    // which reloads the document from SQLite.
    a.type(8, '!');
    const b = await TestClient.connect(id);
    await b.until(() => b.text === 'survives!');
    a.close();
    b.close();
  });

  it('saves when the last client leaves', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'bye');
    await a.until(() => a.text === 'bye');
    a.close();
    await expect.poll(() => storedRows(id)).toBe(1);
    await evictDurableObject(stubFor(id), { webSockets: 'close' }).catch(() => {});
    const b = await TestClient.connect(id);
    expect(b.text).toBe('bye');
    b.close();
  });

  it('deletes a note when the expiry alarm fires', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'temporary');
    await a.until(() => a.text === 'temporary');
    a.close();
    await expect.poll(() => storedRows(id)).toBe(1);

    const alarm = await runInDurableObject(stubFor(id), (_room: NoteRoom, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThan(Date.now() + NOTE_EXPIRY_MS - 60_000);

    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(await storedRows(id)).toBe(0);
    const b = await TestClient.connect(id);
    expect(b.text).toBe('');
    b.close();
  });

  it('never schedules expiry for the public note', async () => {
    const client = await TestClient.connect(PUBLIC_NOTE_ID);
    client.close();
    const alarm = await runInDurableObject(stubFor(PUBLIC_NOTE_ID), (_room: NoteRoom, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeNull();
  });

  it('closes a socket that sends a malformed message, and keeps serving others', async () => {
    const id = generateNoteId();
    const good = await TestClient.connect(id);
    const bad = await TestClient.connect(id);
    bad.send(new Uint8Array([0, 2, 200, 1, 2, 3]));
    await bad.until(() => bad.closed !== null);
    expect(bad.closed!.code).toBe(CLOSE_MALFORMED);

    const text = await TestClient.connect(id);
    text.socket.send('not binary');
    await text.until(() => text.closed !== null);

    const unknown = await TestClient.connect(id);
    unknown.send(new Uint8Array([99]));
    await unknown.until(() => unknown.closed !== null);

    good.type(0, 'still fine');
    const late = await TestClient.connect(id);
    await late.until(() => late.text === 'still fine');
    good.close();
    late.close();
  });

  it('compacts deleted content out of the stored state', async () => {
    const id = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, filler(100_000));
    await a.until(() => a.lastStatus !== null && a.text.length === 100_000);
    a.doc.get('text').delete(0, 100_000);
    await a.until(() => a.text.length === 0);
    await flush(id);
    const stored = await runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
      const row = state.storage.sql.exec('SELECT state FROM note').one();
      return (row.state as ArrayBuffer).byteLength;
    });
    expect(stored).toBeLessThan(1_000);
    a.close();
  });
});
