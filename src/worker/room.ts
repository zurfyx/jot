import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { isNoteId } from '../shared/ids';
import {
  generateImageKey,
  IMAGE_NODE_BYTES,
  imageObjectKey,
  imageObjectPrefix,
  imagePath,
  type ImageUploadResult,
  NOTE_MAX_IMAGE_BYTES,
  NOTE_MAX_IMAGES,
} from '../shared/images';
import { fitsUnderCap, NOTE_EXPIRY_MS, NOTE_MAX_BYTES, SAVE_DEBOUNCE_MS } from '../shared/limits';
import {
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
import { imageHttpMetadata, readUpload, uploadError } from './images';

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
    this.load();
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
    // The note's stored images (D26): the R2 object of each, for its caps and
    // its cleanup at expiry.
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS images (
        object TEXT PRIMARY KEY,
        bytes INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL
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
    this.doc = new Y.Doc({ gc: true });
    // Yjs's format cleanup would delete format items the clients keep (around
    // deleted text, say) and send those deletions out as the room's own edit:
    // @lexical/y requires a relay to turn it off before it applies updates.
    this.doc.cleanupFormatting = false;
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
        this.save();
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

  /** The stored size the client sees, for tests and status messages. */
  get storedBytes(): number {
    return this.size;
  }

  // ---------------------------------------------------------------------------
  // Expiry (D06)

  private touch(): void {
    void this.ctx.storage.setAlarm(Date.now() + NOTE_EXPIRY_MS);
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      // Someone is visiting right now: that counts as a visit.
      await this.ctx.storage.setAlarm(Date.now() + NOTE_EXPIRY_MS);
      return;
    }
    // Nothing else runs until the note is gone, so an upload can't land
    // between deleting its images and deleting its rows.
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.saveTimer !== null) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.dirty = false;
      // Images first: if R2 fails, the alarm throws and is retried with the
      // note's rows still there to say what to delete.
      await this.deleteImages();
      await this.ctx.storage.deleteAll();
      this.resetDoc();
      this.ensureSchema();
    });
  }

  /** Deletes every R2 object under the note's id (D26). */
  private async deleteImages(): Promise<void> {
    this.ensureSchema();
    const prefixes = new Set<string>();
    if (this.noteId !== null) {
      prefixes.add(imageObjectPrefix(this.noteId));
    }
    // The note row may never have been written (images but no text yet).
    for (const { object } of this.ctx.storage.sql
      .exec<{ object: string }>('SELECT object FROM images')
      .toArray()) {
      prefixes.add(`${object.split('/')[0]}/`);
    }
    for (const prefix of prefixes) {
      let cursor: string | undefined;
      do {
        const listed = await this.env.IMAGES.list({ prefix, cursor });
        if (listed.objects.length > 0) {
          await this.env.IMAGES.delete(listed.objects.map((object) => object.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor !== undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Images (D26)

  /** The note's stored images: how many, and their bytes together. */
  imageUsage(): { count: number; bytes: number } {
    this.ensureSchema();
    const row = this.ctx.storage.sql
      .exec<{ count: number; bytes: number | null }>(
        'SELECT COUNT(*) AS count, SUM(bytes) AS bytes FROM images',
      )
      .one();
    return { count: row.count, bytes: row.bytes ?? 0 };
  }

  /**
   * Stores an uploaded image in R2 under the note's id, with a random key,
   * unless the note is full or its images are at their caps.
   */
  private async upload(request: Request, id: string): Promise<Response> {
    const upload = await readUpload(request);
    if (upload instanceof Response) {
      return upload;
    }
    // A note whose text is at the cap couldn't hold the image node: it is
    // read only for everyone (D05).
    if (!fitsUnderCap(this.size + this.pending, IMAGE_NODE_BYTES)) {
      return uploadError('note-full');
    }
    const usage = this.imageUsage();
    if (usage.count >= NOTE_MAX_IMAGES) {
      return uploadError('too-many');
    }
    if (usage.bytes + upload.bytes.byteLength > NOTE_MAX_IMAGE_BYTES) {
      return uploadError('no-room');
    }
    const key = generateImageKey();
    const object = imageObjectKey(id, key);
    // Reserved before the write, in the same synchronous step as the checks,
    // so two uploads at once can't both take the last place.
    this.ctx.storage.sql.exec(
      'INSERT INTO images (object, bytes, type, created_at) VALUES (?, ?, ?, ?)',
      object,
      upload.bytes.byteLength,
      upload.type,
      Date.now(),
    );
    // An upload is a visit: the note and its images expire together.
    this.touch();
    try {
      await this.env.IMAGES.put(object, upload.bytes, {
        httpMetadata: imageHttpMetadata(upload.type),
      });
    } catch (error) {
      console.warn(`[note ${id}] image upload failed:`, String(error));
      this.ctx.storage.sql.exec('DELETE FROM images WHERE object = ?', object);
      return new Response('Could not store the image.', { status: 502 });
    }
    const result: ImageUploadResult = { key, src: imagePath(id, key) };
    return Response.json(result, { status: 201 });
  }

  // ---------------------------------------------------------------------------
  // Connections

  async fetch(request: Request): Promise<Response> {
    const id = request.headers.get(NOTE_ID_HEADER);
    if (id === null || !isNoteId(id)) {
      return new Response('Not a note id.', { status: 400 });
    }
    this.noteId = id;
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/images')) {
      return this.upload(request, id);
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    this.touch();

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
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
      this.drop(ws);
      try {
        ws.close(CLOSE_MALFORMED, 'Malformed message');
      } catch {
        // already closing
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.drop(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  /** Forgets a socket: announces its awareness removal, saves if it was the last. */
  private drop(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment !== null) {
      ws.serializeAttachment({ clocks: {} } satisfies SocketAttachment);
      const removed = this.awareness.remove(attachment.clocks);
      if (removed.length > 0) {
        this.broadcast(encodeAwarenessMessage(removed), ws);
      }
    }
    if (this.openSockets(ws).length === 0) {
      this.save();
    }
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
