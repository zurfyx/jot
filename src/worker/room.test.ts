import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateNoteId, noteSocketPath } from '../shared/ids';
import { NOTE_EXPIRY_MS, NOTE_MAX_BYTES } from '../shared/limits';
import { CLOSE_MALFORMED, MESSAGE_SYNC } from '../shared/protocol';
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

function storedText(id: string): Promise<string> {
  return runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
    const row = state.storage.sql.exec('SELECT state FROM note').one();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state as ArrayBuffer));
    return doc.get('text').toString();
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

  it('has no public note: /n/public is a 400 like any malformed id', async () => {
    for (const path of ['/n/public', '/api/n/public/ws']) {
      const response = await exports.default.fetch(`http://jot.test${path}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(response.status, path).toBe(400);
    }
  });
});

describe('search engines (D17)', () => {
  const NOINDEX = 'noindex, nofollow';

  // The test Worker has no ASSETS binding, so the SPA responses for valid
  // notes and the landing page are covered in e2e (landing.spec.ts).
  it('marks every note and API response noindex, nofollow', async () => {
    const id = generateNoteId();
    const cases: [string, RequestInit, number][] = [
      ['/n/nope', {}, 400],
      ['/n/public', {}, 400],
      [noteSocketPath(id), {}, 426],
      ['/api/n/nope/ws', { headers: { Upgrade: 'websocket' } }, 400],
      ['/api/elsewhere', {}, 404],
    ];
    for (const [path, init, status] of cases) {
      const response = await exports.default.fetch(`http://jot.test${path}`, init);
      expect(response.status, path).toBe(status);
      expect(response.headers.get('X-Robots-Tag'), path).toBe(NOINDEX);
      await response.body?.cancel();
    }
  });

  it('marks the WebSocket upgrade noindex, nofollow and keeps the socket', async () => {
    const response = await exports.default.fetch(
      `http://jot.test${noteSocketPath(generateNoteId())}`,
      { headers: { Upgrade: 'websocket' } },
    );
    expect(response.status).toBe(101);
    expect(response.headers.get('X-Robots-Tag')).toBe(NOINDEX);
    const socket = response.webSocket!;
    socket.accept();
    socket.close();
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
    // The delete is applied locally at once; wait until the room has it too.
    // A client that joins now gets the room's state, then any update still on
    // its way, so its text empties only once the room has applied the delete.
    const witness = await TestClient.connect(id);
    await witness.until(() => witness.text.length === 0);
    await flush(id);
    const stored = await runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
      const row = state.storage.sql.exec('SELECT state FROM note').one();
      return (row.state as ArrayBuffer).byteLength;
    });
    expect(stored).toBeLessThan(1_000);
    a.close();
    witness.close();
  });

  it('keeps the format items the clients keep, and writes nothing of its own', async () => {
    // Ana bolds "A" while Bea deletes it: the bold's format items stay around
    // the deleted text. The clients keep them (@lexical/y turns Yjs's format
    // cleanup off in its containers); the room must store them as they are.
    const quiet = () => {
      const doc = new Y.Doc();
      doc.cleanupFormatting = false;
      return doc;
    };
    const ana = quiet();
    const bea = quiet();
    ana.get('text').insert(0, 'AB');
    Y.applyUpdate(bea, Y.encodeStateAsUpdate(ana));
    ana.get('text').format(0, 1, { bold: true });
    bea.get('text').delete(0, 1);
    Y.applyUpdate(ana, Y.encodeStateAsUpdate(bea));
    const formats = (doc: Y.Doc) => {
      const out: string[] = [];
      for (let item = doc.get('text')._start; item !== null; item = item.right) {
        if (!item.deleted && item.content instanceof Y.ContentFormat) {
          out.push(`${item.content.key}=${JSON.stringify(item.content.value)}`);
        }
      }
      return out;
    };
    expect(formats(ana)).toEqual(['bold=true', 'bold=null']);

    const id = generateNoteId();
    const a = await TestClient.connect(id);
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(ana));
    const witness = await TestClient.connect(id);
    await witness.until(() => witness.text === 'B');
    await flush(id);
    const stored = await runInDurableObject(stubFor(id), (_room: NoteRoom, state) => {
      const row = state.storage.sql.exec('SELECT state FROM note').one();
      return new Uint8Array(row.state as ArrayBuffer);
    });
    const reloaded = quiet();
    Y.applyUpdate(reloaded, stored);
    expect(formats(reloaded)).toEqual(['bold=true', 'bold=null']);
    // The room sent no deletions of its own: the clients keep them too.
    expect(formats(witness.doc)).toEqual(['bold=true', 'bold=null']);
    expect(formats(a.doc)).toEqual(['bold=true', 'bold=null']);
    a.close();
    witness.close();
  });
});

describe('NoteRoom when a socket dies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A sync update inserting `text`, framed as a client sends it. */
  function textUpdate(text: string): ArrayBuffer {
    const doc = new Y.Doc();
    doc.get('text').insert(0, text);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    return encoding.toUint8Array(encoder).slice().buffer;
  }

  it('saves and closes on an abnormal close (1006) without throwing', async () => {
    const id = generateNoteId();
    const errors = vi.spyOn(console, 'error');
    await TestClient.connect(id);
    await runInDurableObject(stubFor(id), async (room: NoteRoom, state) => {
      const [ws] = state.getWebSockets();
      // Applied here, so the room's save timer has not written it yet.
      await room.webSocketMessage(ws!, textUpdate('kept'));
      await expect(room.webSocketClose(ws!, 1006, '')).resolves.toBeUndefined();
      expect(ws!.readyState).not.toBe(WebSocket.OPEN);
    });
    expect(await storedText(id)).toBe('kept');
    expect(errors).not.toHaveBeenCalled();
  });

  it('saves and closes on a socket error without throwing', async () => {
    const id = generateNoteId();
    const errors = vi.spyOn(console, 'error');
    await TestClient.connect(id);
    await runInDurableObject(stubFor(id), async (room: NoteRoom, state) => {
      const [ws] = state.getWebSockets();
      // Applied here, so the room's save timer has not written it yet.
      await room.webSocketMessage(ws!, textUpdate('kept'));
      await expect(room.webSocketError(ws!, new Error('reset'))).resolves.toBeUndefined();
      expect(ws!.readyState).not.toBe(WebSocket.OPEN);
    });
    expect(await storedText(id)).toBe('kept');
    expect(errors).not.toHaveBeenCalled();
  });

  it('survives a dead peer while announcing a departure', async () => {
    const id = generateNoteId();
    const leaving = await TestClient.connect(id);
    const dead = await TestClient.connect(id);
    const { encodeAwarenessUpdate } = await import('./awareness');
    const encoding = await import('lib0/encoding');
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate([{ clientID: 7, clock: 1, state: '{"user":{"name":"Ana"}}' }]),
    );
    leaving.send(encoding.toUint8Array(encoder));
    await dead.until(() => dead.awarenessMessages.length === 1);
    leaving.type(0, 'kept');
    await dead.until(() => dead.text === 'kept');

    const errors = vi.spyOn(console, 'error');
    await runInDurableObject(stubFor(id), async (room: NoteRoom, state) => {
      const announced = (ws: WebSocket) =>
        Object.keys((ws.deserializeAttachment() as { clocks: object }).clocks).length > 0;
      const sockets = state.getWebSockets();
      const departing = sockets.find(announced)!;
      const peer = sockets.find((ws) => !announced(ws))!;
      const send = vi.spyOn(peer, 'send').mockImplementation(() => {
        throw new Error('dead peer');
      });
      await expect(room.webSocketClose(departing, 1006, '')).resolves.toBeUndefined();
      // The removal went to the peer, whose send threw.
      expect(send).toHaveBeenCalledTimes(1);
      expect(departing.readyState).not.toBe(WebSocket.OPEN);
      await expect(room.webSocketClose(peer, 1006, '')).resolves.toBeUndefined();
    });
    expect(await storedText(id)).toBe('kept');
    expect(errors).not.toHaveBeenCalled();
  });

  it('logs a failed save, still closes the socket, and saves on the next try', async () => {
    const id = generateNoteId();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await TestClient.connect(id);
    await runInDurableObject(stubFor(id), async (room: NoteRoom, state) => {
      const [ws] = state.getWebSockets();
      // Applied here, so the room's save timer has not written it yet.
      await room.webSocketMessage(ws!, textUpdate('kept'));
      const save = vi.spyOn(room, 'save').mockImplementationOnce(() => {
        throw new Error('disk full');
      });
      await expect(room.webSocketClose(ws!, 1006, '')).resolves.toBeUndefined();
      expect(ws!.readyState).not.toBe(WebSocket.OPEN);
      expect(save).toHaveBeenCalledTimes(1);
      expect(state.storage.sql.exec('SELECT * FROM note').toArray()).toEqual([]);
    });
    expect(errors).toHaveBeenCalledTimes(1);
    const [message, details] = errors.mock.calls[0]!;
    expect(message).toBe(`[note ${id}] webSocketClose: save failed`);
    expect(details).toMatchObject({
      note: id,
      handler: 'webSocketClose',
      code: 1006,
      error: 'Error: disk full',
    });
    expect((details as { stack: string }).stack).toContain('disk full');

    // The document is still unsaved, so the next save writes it.
    await flush(id);
    expect(await storedText(id)).toBe('kept');
  });
});
