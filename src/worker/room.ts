import { createYDoc } from '@lexical/y/headless';
import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { isNoteId } from '../shared/ids';
import { fitsUnderCap, NOTE_EXPIRY_MS, NOTE_MAX_BYTES, SAVE_DEBOUNCE_MS } from '../shared/limits';
import {
  CLOSE_INTERNAL_ERROR,
  CLOSE_MALFORMED,
  MESSAGE_AWARENESS,
  MESSAGE_NOTE_STATUS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
} from '../shared/protocol';
import {
  type AwarenessChange,
  AwarenessRelay,
  decodeAwarenessUpdate,
  encodeAwarenessUpdate,
} from './awareness';

/** Header the Worker uses to tell a note's Durable Object its id. */
export const NOTE_ID_HEADER = 'x-jot-note';

/** What each hibernatable socket remembers across evictions. */
interface SocketAttachment {
  /** Awareness client ids this socket announced, with their last clocks. */
  clocks: Record<string, number>;
}

class MalformedMessage extends Error {}

/**
 * One note: a Yjs 14 relay (D03) that speaks the y-websocket protocol to
 * `@y/websocket` clients, keeps the document in memory, and stores it as one
 * SQLite row (D01, D05). Sockets use the Hibernation API, so an idle note
 * costs nothing; on wake the constructor reloads the document from storage.
 */
export class NoteRoom extends DurableObject<Env> {
  private doc!: Y.Doc;
  /** Exact encoded size of the document when last measured. */
  private size = 0;
  /** Bytes of updates applied since `size` was measured (an upper bound). */
  private pending = 0;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private noteId: string | null = null;
  private readonly awareness = new AwarenessRelay();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    try {
      this.load();
    } catch (error) {
      // Rethrown: a room that cannot read its note must not serve it.
      this.logError('constructor', error, undefined, 'loading the note failed');
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Storage

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS note (
        id INTEGER PRIMARY KEY CHECK (id = 0),
        name TEXT NOT NULL,
        state BLOB NOT NULL,
        saved_at INTEGER NOT NULL
      )`,
    );
  }

  /** Loads the stored state into a fresh gc-on document. */
  private load(): void {
    this.ensureSchema();
    this.resetDoc();
    const rows = this.ctx.storage.sql
      .exec<{ name: string; state: ArrayBuffer }>('SELECT name, state FROM note WHERE id = 0')
      .toArray();
    const row = rows[0];
    if (row !== undefined) {
      this.noteId = row.name;
      Y.applyUpdate(this.doc, new Uint8Array(row.state), this);
      // Re-encoding from a gc-on document compacts what was stored (D05).
      this.size = Y.encodeStateAsUpdate(this.doc).byteLength;
    }
  }

  private resetDoc(): void {
    this.doc?.destroy();
    // @lexical/y's relay document: garbage collected, with Yjs's format cleanup
    // off, which would otherwise delete format items the clients keep (around
    // deleted text, say) and send those deletions out as the room's own edit.
    this.doc = createYDoc();
    this.size = 0;
    this.pending = 0;
    this.doc.on('update', (update: Uint8Array) => {
      // Every client gets every update, the sender included: @y/websocket
      // counts its own updates as confirmed when they come back.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer === null) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.trySave('save timer');
      }, SAVE_DEBOUNCE_MS);
    }
  }

  /**
   * Writes the whole document as one row. The state comes from
   * `encodeStateAsUpdate` of a gc-on document, so every save is also a
   * compaction: deleted content does not accumulate in storage (D05).
   */
  save(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) {
      return;
    }
    const state = Y.encodeStateAsUpdate(this.doc);
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO note (id, name, state, saved_at) VALUES (0, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, state = excluded.state,
         saved_at = excluded.saved_at`,
      this.noteId ?? '',
      toArrayBuffer(state),
      Date.now(),
    );
    this.dirty = false;
    this.size = state.byteLength;
    this.pending = 0;
    this.broadcast(encodeNoteStatus(this.size, 0));
  }

  /**
   * Saves, logging a failure instead of throwing it. The document stays dirty,
   * so the next change's timer or the next departure tries again.
   */
  private trySave(handler: string, code?: number): void {
    try {
      this.save();
    } catch (error) {
      this.logError(handler, error, code, 'save failed');
    }
  }

  /** The stored size the client sees, for tests and status messages. */
  get storedBytes(): number {
    return this.size;
  }

  // ---------------------------------------------------------------------------
  // Expiry (D06)

  private touch(): void {
    this.ctx.storage.setAlarm(Date.now() + NOTE_EXPIRY_MS).catch((error: unknown) => {
      this.logError('fetch', error, undefined, 'setting the expiry alarm failed');
    });
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      // Someone is visiting right now: that counts as a visit.
      await this.ctx.storage.setAlarm(Date.now() + NOTE_EXPIRY_MS);
      return;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;
    await this.ctx.storage.deleteAll();
    this.resetDoc();
    this.ensureSchema();
  }

  // ---------------------------------------------------------------------------
  // Connections

  async fetch(request: Request): Promise<Response> {
    const id = request.headers.get(NOTE_ID_HEADER);
    if (id === null || !isNoteId(id)) {
      return new Response('Not a note id.', { status: 400 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    this.noteId = id;
    this.touch();

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    try {
      server.serializeAttachment({ clocks: {} } satisfies SocketAttachment);
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(step1, this.doc);
      server.send(encoding.toUint8Array(step1));
      const states = this.awareness.snapshot();
      if (states.length > 0) {
        server.send(encodeAwarenessMessage(states));
      }
      server.send(encodeNoteStatus(this.size + this.pending, 0));
    } catch (error) {
      // The socket is already accepted: forget it rather than leave it open
      // with nobody on the other end.
      this.logError('fetch', error);
      this.forget(server, 'fetch', CLOSE_INTERNAL_ERROR, 'Internal error');
      return new Response('Could not open the note.', { status: 500 });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      if (typeof message === 'string') {
        throw new MalformedMessage('text frame');
      }
      this.receive(ws, new Uint8Array(message));
    } catch (error) {
      // Malformed input is ignored and its socket closed (D01).
      console.warn(`[note ${this.noteId}] closing socket:`, String(error));
      this.forget(ws, 'webSocketMessage', CLOSE_MALFORMED, 'Malformed message');
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.forget(ws, 'webSocketClose', code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.warn(`[note ${this.noteId}] socket error:`, String(error));
    this.forget(ws, 'webSocketError', CLOSE_INTERNAL_ERROR, 'Socket error');
  }

  /**
   * Drops a socket and closes it. Never throws: a handler that throws reaches
   * the logs as a bare "exception" with no message, and skips the close.
   */
  private forget(ws: WebSocket, handler: string, code: number, reason: string): void {
    this.drop(ws, handler, code);
    try {
      ws.close(sendableCloseCode(code), reason);
    } catch {
      // already closed
    }
  }

  /**
   * Forgets a socket: announces its awareness removal, saves if it was the
   * last. Each step logs its own failure so the next one still runs.
   */
  private drop(ws: WebSocket, handler: string, code?: number): void {
    try {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (attachment !== null) {
        ws.serializeAttachment({ clocks: {} } satisfies SocketAttachment);
        const removed = this.awareness.remove(attachment.clocks);
        if (removed.length > 0) {
          this.broadcast(encodeAwarenessMessage(removed), ws);
        }
      }
    } catch (error) {
      this.logError(handler, error, code, 'awareness removal failed');
    }
    try {
      if (this.openSockets(ws).length === 0) {
        this.trySave(handler, code);
      }
    } catch (error) {
      this.logError(handler, error, code, 'listing sockets failed');
    }
  }

  private logError(handler: string, error: unknown, code?: number, what = 'failed'): void {
    console.error(`[note ${this.noteId}] ${handler}: ${what}`, {
      note: this.noteId,
      handler,
      ...(code === undefined ? {} : { code }),
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  private openSockets(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  private broadcast(message: Uint8Array, except?: WebSocket): void {
    for (const ws of this.openSockets(except)) {
      try {
        ws.send(message);
      } catch {
        // The runtime closes broken sockets and calls webSocketClose.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Protocol

  private receive(ws: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    if (!decoding.hasContent(decoder)) {
      throw new MalformedMessage('empty frame');
    }
    while (decoding.hasContent(decoder)) {
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case MESSAGE_SYNC:
          this.receiveSync(ws, decoder);
          break;
        case MESSAGE_AWARENESS:
          this.receiveAwareness(ws, decoding.readVarUint8Array(decoder));
          break;
        case MESSAGE_QUERY_AWARENESS:
          ws.send(encodeAwarenessMessage(this.awareness.snapshot()));
          break;
        default:
          throw new MalformedMessage(`unknown message type ${type}`);
      }
    }
  }

  private receiveSync(ws: WebSocket, decoder: decoding.Decoder): void {
    const subtype = decoding.readVarUint(decoder);
    switch (subtype) {
      case SYNC_STEP_1: {
        const stateVector = decoding.readVarUint8Array(decoder);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(encoder, this.doc, stateVector);
        ws.send(encoding.toUint8Array(encoder));
        return;
      }
      case SYNC_STEP_2:
      case SYNC_UPDATE:
        this.receiveUpdate(ws, decoding.readVarUint8Array(decoder));
        return;
      default:
        throw new MalformedMessage(`unknown sync message ${subtype}`);
    }
  }

  /**
   * Applies a client's update unless it would push the stored state past the
   * cap (D05). The cheap bound (`size + pending + update`) decides almost
   * every update; near the cap the merged size is measured exactly.
   */
  private receiveUpdate(ws: WebSocket, update: Uint8Array): void {
    if (update.byteLength === 0) {
      throw new MalformedMessage('empty update');
    }
    if (!fitsUnderCap(this.size + this.pending, update.byteLength)) {
      const state = Y.encodeStateAsUpdate(this.doc);
      const merged = Y.mergeUpdates([state, update as Uint8Array<ArrayBuffer>]);
      this.size = state.byteLength;
      this.pending = 0;
      if (merged.byteLength > NOTE_MAX_BYTES) {
        ws.send(encodeNoteStatus(this.size, NOTE_STATUS_REJECTED));
        return;
      }
    }
    Y.applyUpdate(this.doc, update, ws);
    this.pending += update.byteLength;
    this.scheduleSave();
  }

  private receiveAwareness(ws: WebSocket, update: Uint8Array): void {
    const accepted = this.awareness.apply(decodeAwarenessUpdate(update));
    if (accepted.length === 0) {
      return;
    }
    const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? { clocks: {} };
    for (const change of accepted) {
      if (change.state === 'null') {
        delete attachment.clocks[change.clientID];
      } else {
        attachment.clocks[change.clientID] = change.clock;
      }
    }
    ws.serializeAttachment(attachment);
    // The sender gets its own update back too: @y/websocket treats any message
    // as a sign of life and closes sockets that stay silent.
    this.broadcast(encodeAwarenessMessage(accepted));
  }
}

function encodeAwarenessMessage(changes: AwarenessChange[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(changes));
  return encoding.toUint8Array(encoder);
}

export function encodeNoteStatus(bytes: number, flags: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_NOTE_STATUS);
  encoding.writeVarUint(encoder, bytes);
  encoding.writeVarUint(encoder, flags);
  return encoding.toUint8Array(encoder);
}

/**
 * A code this side may send. 1005, 1006 and 1015 only describe a close that
 * had no close frame; `close()` throws on them.
 */
function sendableCloseCode(code: number): number {
  return code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
