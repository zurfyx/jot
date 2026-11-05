import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import {
  decodeUpload,
  type Handshake,
  parseHandshake,
  type RecoveryListItem,
  sha256Hex,
  UNKNOWN_GENERATION,
  type UploadAcknowledgement,
  UPLOAD_HASH_HEADER,
  UPLOAD_MAX_BYTES,
} from '../shared/fence';
import { isNoteId } from '../shared/ids';
import { fitsUnderCap, NOTE_EXPIRY_MS, NOTE_MAX_BYTES, SAVE_DEBOUNCE_MS } from '../shared/limits';
import {
  CLOSE_INTERNAL_ERROR,
  CLOSE_MALFORMED,
  CLOSE_NOTE_UPGRADED,
  FENCE_ADMIT,
  FENCE_BOOTSTRAP,
  FENCE_REFUSE_LAYOUT,
  FENCE_STALE,
  MESSAGE_AWARENESS,
  MESSAGE_NOTE_FENCE,
  MESSAGE_NOTE_STATUS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
} from '../shared/protocol';
import { SCHEMA_VERSION } from '../shared/schema';
import {
  type AwarenessChange,
  AwarenessRelay,
  decodeAwarenessUpdate,
  encodeAwarenessUpdate,
} from './awareness';
import {
  buildRecord,
  createYDoc,
  SEED_LAYOUT,
  describeRoom,
  captureOf,
  getYGeneration,
  pendingRecord,
  prepareNote,
  recordFrom,
  recoveryState,
  replaceIncarnation,
  SERVED_ROOTS,
  storedSourceView,
  verdictFor,
  type YLegacySignal,
  type YRecordSource,
} from './library';
import {
  appendPart,
  ensureFenceSchema,
  insertBase,
  insertTransition,
  readBase,
  sameIncarnationSince,
  readPhase,
  writePhase,
  insertRecord,
  listRecords,
  MAX_RECORD_BYTES,
  MAX_RECORDS,
  newIncarnation,
  pruneQuarantine,
  quarantineUsage,
  readMaterial,
  readRecord,
  readRoom,
  recordByUpload,
  type RoomRow,
  updateRecordFacts,
  writeRoom,
} from './quarantine';
import { noteTag, shadowReceipt } from './shadow';
import { freshCopy } from './copy';
import { LAYOUT_FLOOR } from './steps';

/** Header the Worker uses to tell a note's Durable Object its id. */
export const NOTE_ID_HEADER = 'x-jot-note';

/**
 * What a socket is to the room (D34): admitted at a generation, a capture
 * of a client from before the fence (`legacy`), or a client fenced out
 * (`stale`: edits made against another generation; `refused`: a release that
 * cannot read or seed the note). Only admitted sockets of the room's
 * generation receive or apply anything.
 */
type SocketRole = 'admit' | 'legacy' | 'stale' | 'refused';

/** What each hibernatable socket remembers across evictions. */
interface SocketAttachment {
  /** Awareness client ids this socket announced, with their last clocks. */
  clocks: Record<string, number>;
  /** Absent on a socket accepted before the fence: treated as admitted. */
  role?: SocketRole;
  /** The generation it was admitted at, or the one it presented. */
  gen?: string | null;
  /** Its quarantine record, once it sent something that is kept there. */
  rec?: number;
  /** Whether its record holds its snapshot yet (legacy captures). */
  snap?: boolean;
  /** The handshake it presented (stale captures name their source with it). */
  hs?: Handshake | null;
}

class MalformedMessage extends Error {}

/**
 * One note: a Yjs 14 relay (D03) that speaks the y-websocket protocol to
 * `@y/websocket` clients, keeps the document in memory, and stores it as one
 * SQLite row (D01, D05). Sockets use the Hibernation API, so an idle note
 * costs nothing; on wake the constructor reloads the document from storage.
 * The generation fence (D34) decides per socket whether it syncs, and keeps
 * edits made against another generation in a quarantine.
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
  private room: RoomRow | null = null;
  private shadowed = false;
  private pruned = false;
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
    ensureFenceSchema(this.ctx.storage.sql);
  }

  /** Loads the stored state into a fresh gc-on document. */
  private load(): void {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<{ name: string; state: ArrayBuffer }>('SELECT name, state FROM note WHERE id = 0')
      .toArray();
    const row = rows[0];
    this.resetDoc(row === undefined ? null : new Uint8Array(row.state));
    if (row !== undefined) {
      this.noteId = row.name;
      // Re-encoding from a gc-on document compacts what was stored (D05).
      this.size = Y.encodeStateAsUpdate(this.doc).byteLength;
    }
    this.room = readRoom(this.ctx.storage.sql);
  }

  /**
   * A fresh relay document, holding `state` when given. `@lexical/y/server`'s
   * createYDoc: garbage collected, with Yjs's format cleanup off, which would
   * otherwise delete format items the clients keep (around deleted text, say)
   * and send those deletions out as the room's own edit; and it loads stored
   * bytes whole, text a client integrated across a missing update included,
   * which a plain applyUpdate would hold pending.
   */
  private resetDoc(state: Uint8Array | null = null): void {
    this.doc?.destroy();
    this.doc = createYDoc(state);
    this.size = 0;
    this.pending = 0;
    this.doc.on('update', (update: Uint8Array) => {
      // Every admitted client gets every update, the sender included:
      // @y/websocket counts its own updates as confirmed when they come back.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  /**
   * The room's incarnation and generation (D34), created at the first visit
   * that finds none: inherited when the note already had a stored row (it
   * existed before the fence), so clients from before the fence keep
   * editing it as today until it first migrates or is replaced. A pristine
   * room issued under another seed contract gets a new incarnation.
   */
  private identity(): RoomRow {
    let room = this.room;
    if (room === null) {
      const incarnation = newIncarnation();
      room = {
        incarnation,
        inherited: this.hasStoredRow(),
        seedContract: SEED_LAYOUT,
        generation: getYGeneration(this.doc, incarnation, SERVED_ROOTS),
        createdAt: Date.now(),
      };
    } else if (replaceIncarnation(this.describe(room), SEED_LAYOUT)) {
      const incarnation = newIncarnation();
      room = {
        incarnation,
        inherited: false,
        seedContract: SEED_LAYOUT,
        generation: getYGeneration(this.doc, incarnation, SERVED_ROOTS),
        createdAt: Date.now(),
      };
    } else {
      return room;
    }
    writeRoom(this.ctx.storage.sql, room);
    this.room = room;
    return room;
  }

  /** Whether the note has a stored row (it was written before). */
  private hasStoredRow(): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM note WHERE id = 0').toArray().length > 0;
  }

  /** The room as the handshake verdict sees it, with its stored generation. */
  private describe(room: RoomRow) {
    return { ...describeRoom(this.doc, room), generation: room.generation };
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

  /**
   * Development and tests only (the Worker routes to it only in development
   * builds): a new incarnation for the same state, every socket closed, as
   * a migration will do (D34).
   */
  testReplaceIncarnation(inherited = false): void {
    if (!import.meta.env.DEV) {
      throw new Error('Not in a production build.');
    }
    this.trySave('test');
    const incarnation = newIncarnation();
    const room: RoomRow = {
      incarnation,
      inherited,
      seedContract: SEED_LAYOUT,
      generation: getYGeneration(this.doc, incarnation, SERVED_ROOTS),
      createdAt: Date.now(),
    };
    writeRoom(this.ctx.storage.sql, room);
    this.room = room;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_NOTE_UPGRADED, 'Note upgraded');
      } catch {
        // already closed
      }
    }
  }

  /** The room's incarnation, inheritance and generation, for tests. */
  get fenceIdentity(): RoomRow | null {
    return this.room;
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
    // The note, its incarnation and its quarantine are gone: a visit creates
    // it again under a new incarnation, which no earlier copy matches.
    this.room = null;
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
    const url = new URL(request.url);
    this.noteId = id;
    // Before anything is served: a note below the floor migrates now (D34).
    this.ensureCurrent(this.identity());
    if (url.pathname.endsWith('/ws')) {
      return this.openSocket(request, url, id);
    }
    return this.recovery(request, url, id);
  }

  // ---------------------------------------------------------------------------
  // The migration moment (D34, design section 3)

  /** The layout every served root must be at: the Worker's, or a test's (development only). */
  private floor(): number {
    if (import.meta.env.DEV) {
      const value = this.testSetting('floor');
      if (value !== null) {
        return value;
      }
    }
    return LAYOUT_FLOOR;
  }

  /** The stored state's cap (D05), or a test's (development only). */
  private maxBytes(): number {
    if (import.meta.env.DEV) {
      const value = this.testSetting('maxBytes');
      if (value !== null) {
        return value;
      }
    }
    return NOTE_MAX_BYTES;
  }

  private testSetting(key: string): number | null {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS test_settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    );
    const row = sql
      .exec<{ value: number }>('SELECT value FROM test_settings WHERE key = ?', key)
      .toArray()[0];
    return row === undefined ? null : row.value;
  }

  /** Development and tests only: raise the floor or lower the cap for this note. */
  testSettings(settings: { floor?: number; maxBytes?: number }): void {
    if (!import.meta.env.DEV) {
      throw new Error('Not in a production build.');
    }
    this.testSetting('floor');
    for (const [key, value] of Object.entries(settings)) {
      this.ctx.storage.sql.exec(
        'INSERT INTO test_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
    }
  }

  /**
   * Migrates the note when a served root is below the floor (design section
   * 3), before anything is served. Synchronous from the check to the commit
   * (a Durable Object interleaves only at awaits), so nothing else runs in
   * between: the barrier and the compare-and-set.
   */
  private ensureCurrent(room: RoomRow): void {
    const sql = this.ctx.storage.sql;
    if (readPhase(sql) === 'stuck') {
      return;
    }
    const floor = this.floor();
    const described = describeRoom(this.doc, room);
    if (described.unreadable.length > 0) {
      // A served root with content but no well-formed layout record or epoch:
      // nothing reads or migrates it (no client is admitted). Stuck, logged.
      writePhase(sql, 'stuck');
      this.logError(
        'migration',
        new Error(described.unreadable.join(', ')),
        undefined,
        'unreadable roots; the note is stuck',
      );
      return;
    }
    if (described.pristine || described.layouts === null || described.layouts[0] >= floor) {
      return;
    }
    // 1. Barrier: every socket closes; what they sent before is applied
    //    already (each message is applied before its handler returns).
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_NOTE_UPGRADED, 'Note upgraded');
      } catch {
        // already closed
      }
    }
    // 2. Seal: the live document, saved, is what migrates (not a debounced row).
    this.dirty = true;
    this.save();
    const stored = Y.encodeStateAsUpdate(this.doc);
    // 3. Migrate a copy.
    let prepared;
    try {
      prepared = prepareNote(stored, room.incarnation, floor);
    } catch (error) {
      writePhase(sql, 'stuck');
      this.logError('migration', error, undefined, 'the note could not be migrated; it is stuck');
      return;
    }
    if (!prepared.changed) {
      return;
    }
    if (prepared.state.byteLength > this.maxBytes()) {
      this.freshDocument(room, stored, prepared.state);
      return;
    }
    // 4. Commit atomically: the state, the generation, the base, the transition.
    const migrated = prepared.state;
    const generation = prepared.generation;
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        'UPDATE note SET state = ?, saved_at = ? WHERE id = 0',
        toArrayBuffer(migrated),
        Date.now(),
      );
      insertBase(sql, room.generation, room.incarnation, stored);
      insertTransition(sql, room.generation, generation, 'in-place', prepared.receipt);
      writeRoom(sql, { ...room, generation });
      if (prepared.pending !== null) {
        const built = pendingRecord(
          stored,
          prepared.pending,
          {
            incarnation: room.incarnation,
            generation: room.generation,
            layouts: null,
            schemaVersion: null,
            renderer: null,
          },
          { generation, state: migrated },
        );
        this.storeBuilt(built, room.generation);
      }
    });
    this.room = { ...room, generation };
    this.reload(migrated);
    console.log('[migration]', JSON.stringify({ note: this.noteId, ...prepared.receipt }));
  }

  /** Replaces the in-memory document with `state` (after a migration). */
  private reload(state: Uint8Array): void {
    this.resetDoc(state);
    this.size = state.byteLength;
    this.dirty = false;
  }

  /** Stores a built record (a `pending` record at a migration) with its parts. */
  private storeBuilt(built: ReturnType<typeof pendingRecord>, base: string): number {
    const sql = this.ctx.storage.sql;
    const r = built.record;
    const seq = insertRecord(sql, {
      kind: 'pending',
      session: null,
      replica: 'pending',
      source: r.source,
      base,
      receivedAt: r.receivedAt,
      updatedAt: r.receivedAt,
      hash: r.hash,
      upload: null,
      complete: r.complete,
      actionable: built.actionable,
      clients: [],
      newClients: built.newClients,
      peers: true,
      draft: null,
      signals: [],
      collisions: [],
      bytes: (r.snapshot?.byteLength ?? 0) + r.queue.reduce((n, q) => n + q.byteLength, 0),
    });
    if (r.snapshot !== null) {
      appendPart(sql, seq, 'snapshot', r.snapshot);
    }
    for (const q of r.queue) {
      appendPart(sql, seq, 'queue', q);
    }
    return seq;
  }

  /**
   * The note's migrated state passes the cap (D05): a whole-document
   * transfer under a new incarnation (design section 6): every live item
   * copied as it is into new items (`copy.ts`, Yjs only). Content ids, cursors and blame
   * attribution are lost for this note; every replica is then another
   * incarnation (its edits go to the recovery view). If the
   * fresh state is still over the cap, the note is stuck.
   */
  private freshDocument(room: RoomRow, stored: Uint8Array, migrated: Uint8Array): void {
    const sql = this.ctx.storage.sql;
    let fresh: Uint8Array;
    try {
      fresh = freshCopy(migrated);
    } catch (error) {
      writePhase(sql, 'stuck');
      this.logError('migration', error, undefined, 'the fresh document failed; the note is stuck');
      return;
    }
    if (fresh.byteLength > this.maxBytes()) {
      writePhase(sql, 'stuck');
      this.logError(
        'migration',
        new Error(`${fresh.byteLength} bytes`),
        undefined,
        'the fresh document is over the cap; the note is stuck',
      );
      return;
    }
    const incarnation = newIncarnation();
    const doc = createYDoc(fresh, { gc: true });
    const generation = getYGeneration(doc, incarnation, SERVED_ROOTS);
    doc.destroy();
    const next: RoomRow = {
      incarnation,
      inherited: false,
      seedContract: SEED_LAYOUT,
      generation,
      createdAt: Date.now(),
    };
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        'UPDATE note SET state = ?, saved_at = ? WHERE id = 0',
        toArrayBuffer(fresh),
        Date.now(),
      );
      insertBase(sql, room.generation, room.incarnation, stored);
      insertTransition(sql, room.generation, generation, 'fresh', {
        bytesBefore: stored.byteLength,
        bytesMigrated: migrated.byteLength,
        bytesFresh: fresh.byteLength,
      });
      writeRoom(sql, next);
    });
    this.room = next;
    this.reload(fresh);
    console.log(
      '[migration]',
      JSON.stringify({ note: this.noteId, fresh: true, bytes: fresh.byteLength }),
    );
  }

  private openSocket(request: Request, url: URL, id: string): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    let handshake: Handshake | null;
    try {
      handshake = parseHandshake(url);
    } catch {
      return new Response('Malformed handshake.', { status: 400 });
    }
    this.noteId = id;
    this.touch();
    const room = this.identity();
    const verdict = verdictFor(this.describe(room), handshake);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    try {
      switch (verdict.verdict) {
        case 'admit':
        case 'bootstrap': {
          server.serializeAttachment({
            clocks: {},
            role: 'admit',
            gen: room.generation,
          } satisfies SocketAttachment);
          if (handshake !== null) {
            server.send(
              encodeFence(
                verdict.verdict === 'admit' ? FENCE_ADMIT : FENCE_BOOTSTRAP,
                room.generation,
                verdict.initialize,
              ),
            );
          }
          const step1 = encoding.createEncoder();
          encoding.writeVarUint(step1, MESSAGE_SYNC);
          syncProtocol.writeSyncStep1(step1, this.doc);
          server.send(encoding.toUint8Array(step1));
          const states = this.awareness.snapshot();
          if (states.length > 0) {
            server.send(encodeAwarenessMessage(states));
          }
          server.send(encodeNoteStatus(this.size + this.pending, 0));
          break;
        }
        case 'stale':
        case 'refuse-layout':
          server.serializeAttachment({
            clocks: {},
            role: verdict.verdict === 'stale' ? 'stale' : 'refused',
            gen: handshake?.generation ?? null,
            hs: handshake,
          } satisfies SocketAttachment);
          server.send(
            encodeFence(
              verdict.verdict === 'stale' ? FENCE_STALE : FENCE_REFUSE_LAYOUT,
              room.generation,
              false,
            ),
          );
          break;
        case 'legacy': {
          // A client from before the fence on a room it may not join: its
          // sync step 2 to an empty state vector is its whole document, kept
          // as a standalone snapshot; nothing of the room is ever sent to it.
          const rec = this.openRecord('capture', 'legacy', UNKNOWN_SOURCE, true);
          server.serializeAttachment({
            clocks: {},
            role: 'legacy',
            gen: null,
            rec,
            snap: false,
          } satisfies SocketAttachment);
          const step1 = encoding.createEncoder();
          encoding.writeVarUint(step1, MESSAGE_SYNC);
          encoding.writeVarUint(step1, SYNC_STEP_1);
          encoding.writeVarUint8Array(step1, new Uint8Array([0]));
          server.send(encoding.toUint8Array(step1));
          break;
        }
      }
    } catch (error) {
      // The socket is already accepted: forget it rather than leave it open
      // with nobody on the other end.
      this.logError('fetch', error);
      this.forget(server, 'fetch', CLOSE_INTERNAL_ERROR, 'Internal error');
      return new Response('Could not open the note.', { status: 500 });
    }
    this.shadow(id);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Shadow receipts (D34): a logged dry run of the layout 3 migration, once per instance. */
  private shadow(id: string): void {
    const flag = (this.env as unknown as Record<string, unknown>).JOT_SHADOW_RECEIPTS;
    if (flag !== '1' || this.shadowed || !this.hasStoredRow()) {
      return;
    }
    this.shadowed = true;
    const state = Y.encodeStateAsUpdate(this.doc);
    void noteTag(id).then((tag) => {
      console.log('[shadow receipt]', JSON.stringify(shadowReceipt(tag, state)));
    });
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
        ws.serializeAttachment({ ...attachment, clocks: {} } satisfies SocketAttachment);
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

  /** Whether a socket is admitted at the room's current generation. */
  private admitted(ws: WebSocket): boolean {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.role === undefined) {
      // Accepted before the fence (a code update closes those): as today.
      return true;
    }
    return attachment.role === 'admit' && attachment.gen === this.room?.generation;
  }

  /** Sends to every admitted socket of the room's generation; nothing to any other. */
  private broadcast(message: Uint8Array, except?: WebSocket): void {
    for (const ws of this.openSockets(except)) {
      if (!this.admitted(ws)) {
        continue;
      }
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
    // Checked when the frame is applied (D34): a socket whose generation is no
    // longer the note's has what it sends kept, not applied.
    const admitted = this.admitted(ws);
    while (decoding.hasContent(decoder)) {
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case MESSAGE_SYNC:
          if (admitted) {
            this.receiveSync(ws, decoder);
          } else {
            this.receiveFenced(ws, decoder);
          }
          break;
        case MESSAGE_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          if (admitted) {
            this.receiveAwareness(ws, update);
          }
          break;
        }
        case MESSAGE_QUERY_AWARENESS:
          if (admitted) {
            ws.send(encodeAwarenessMessage(this.awareness.snapshot()));
          }
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
      case SYNC_UPDATE: {
        const update = decoding.readVarUint8Array(decoder);
        if (readPhase(this.ctx.storage.sql) === 'stuck') {
          // A note whose migration failed applies nothing (D34): kept instead.
          Y.decodeUpdate(update);
          const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? {
            clocks: {},
          };
          this.capture(ws, attachment, update);
          return;
        }
        this.receiveUpdate(ws, update);
        return;
      }
      default:
        throw new MalformedMessage(`unknown sync message ${subtype}`);
    }
  }

  /**
   * A sync message from a socket that is not admitted at the room's
   * generation: never answered with anything of the room, never applied.
   * Content (a sync step 2 or an update) is kept in the socket's record.
   */
  private receiveFenced(ws: WebSocket, decoder: decoding.Decoder): void {
    const subtype = decoding.readVarUint(decoder);
    if (subtype === SYNC_STEP_1) {
      decoding.readVarUint8Array(decoder);
      return;
    }
    if (subtype !== SYNC_STEP_2 && subtype !== SYNC_UPDATE) {
      throw new MalformedMessage(`unknown sync message ${subtype}`);
    }
    const update = decoding.readVarUint8Array(decoder);
    // Throws if it isn't a Yjs update.
    Y.decodeUpdate(update);
    const attachment = (ws.deserializeAttachment() as SocketAttachment | null) ?? { clocks: {} };
    this.capture(ws, attachment, update);
  }

  /**
   * Keeps what a fenced socket sent (D34): a legacy capture's first content
   * is its snapshot, then deltas; once the snapshot is in, the legacy client
   * gets the signal that turns it read only (built on its own snapshot) and
   * then an empty sync step 2. Anything a stale or refused socket sends, or
   * an admitted one whose generation is no longer the room's, is kept the
   * same way, without a signal.
   */
  private capture(ws: WebSocket, attachment: SocketAttachment, update: Uint8Array): void {
    const sql = this.ctx.storage.sql;
    let rec = attachment.rec;
    if (rec === undefined || readRecord(sql, rec) === null) {
      rec = this.openRecord('capture', attachment.role ?? 'stale', sourceOf(attachment.hs), true);
      attachment.rec = rec;
      attachment.snap = false;
    }
    const first = attachment.snap !== true;
    appendPart(sql, rec, first ? 'snapshot' : 'delta', update);
    attachment.snap = true;
    ws.serializeAttachment(attachment);
    const stored = readRecord(sql, rec)!;
    const material = readMaterial(sql, rec);
    const signals = [...stored.signals];
    const send: Uint8Array[] = [];
    if (attachment.role === 'legacy' && first) {
      signals.push(this.signalFor(material));
      send.push(encodeSyncMessage(SYNC_UPDATE, signals[signals.length - 1]!.update));
      send.push(encodeSyncMessage(SYNC_STEP_2, new Uint8Array([0, 0])));
    }
    let built = this.buildFacts(stored, material, signals);
    if (attachment.role === 'legacy') {
      // A signal whose id the client's own content took is not a signal:
      // keep it as the client's, and send another under a new id.
      const known = new Set(stored.collisions.map((c) => `${c.client}.${c.clock}`));
      for (const collision of built.record.collisions) {
        if (!known.has(`${collision.client}.${collision.clock}`)) {
          signals.push(this.signalFor(material));
          send.push(encodeSyncMessage(SYNC_UPDATE, signals[signals.length - 1]!.update));
        }
      }
      if (signals.length !== built.record.signals.length) {
        built = this.buildFacts(stored, material, signals);
      }
    }
    updateRecordFacts(sql, rec, {
      hash: built.record.hash,
      complete: built.record.complete,
      actionable: built.actionable,
      newClients: built.newClients,
      signals,
      collisions: [...built.record.collisions],
      bytes: materialBytes(material),
      updatedAt: Date.now(),
    });
    for (const message of send) {
      ws.send(message);
    }
  }

  private signalFor(material: ReturnType<typeof readMaterial>) {
    // A fresh capture each time: it signs the material as it is now, under a
    // new client id; the record keeps every signal sent.
    return captureOf(material, []).signal(SCHEMA_VERSION)!;
  }

  private buildFacts(
    stored: NonNullable<ReturnType<typeof readRecord>>,
    material: ReturnType<typeof readMaterial>,
    signals: YLegacySignal[],
  ) {
    return buildRecord(
      {
        kind: stored.kind,
        session: stored.session,
        replica: stored.replica,
        source: stored.source,
        snapshot: material.snapshot,
        deltas: material.deltas,
        queue: material.queue,
        draft: stored.draft,
        signals,
        receivedAt: stored.receivedAt,
        clients: stored.clients,
        peers: stored.peers,
      },
      { generation: this.identity().generation, state: Y.encodeStateAsUpdate(this.doc) },
    );
  }

  /** Opens an empty record for a session's material; returns its seq. */
  private openRecord(
    kind: 'capture',
    replica: string,
    source: YRecordSource,
    peers: boolean,
  ): number {
    const now = Date.now();
    return insertRecord(this.ctx.storage.sql, {
      kind,
      session: newIncarnation().slice(0, 12),
      replica,
      source,
      base: null,
      receivedAt: now,
      updatedAt: now,
      hash: '',
      upload: null,
      complete: true,
      actionable: false,
      clients: [],
      newClients: [],
      peers,
      draft: null,
      signals: [],
      collisions: [],
      bytes: 0,
    });
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

  // ---------------------------------------------------------------------------
  // Recovery (D34): uploads of offline edits, the list, a record's source view
  // and its raw export.

  private async recovery(request: Request, url: URL, id: string): Promise<Response> {
    const match = /\/recovery(?:\/(\d+)\/(view|raw))?$/.exec(url.pathname);
    if (match === null) {
      return new Response('Not found.', { status: 404 });
    }
    const sql = this.ctx.storage.sql;
    if (!this.pruned) {
      this.pruned = true;
      pruneQuarantine(sql, Date.now());
    }
    const [, seqText, view] = match;
    if (seqText === undefined) {
      if (request.method === 'POST') {
        return this.upload(request, id);
      }
      if (request.method !== 'GET') {
        return new Response('Method not allowed.', { status: 405 });
      }
      const items: RecoveryListItem[] = listRecords(sql).map((r) => ({
        seq: r.seq,
        kind: r.kind,
        replica: r.replica,
        receivedAt: r.receivedAt,
        actionable: r.actionable,
        complete: r.complete,
        clients: [...new Set([...r.clients, ...r.newClients])],
        upload: r.upload,
        bytes: r.bytes,
      }));
      return Response.json({ records: items });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed.', { status: 405 });
    }
    const seq = Number(seqText);
    const record = readRecord(sql, seq);
    if (record === null) {
      return new Response('No such record.', { status: 404 });
    }
    const material = readMaterial(sql, seq);
    if (view === 'view') {
      // What the page renders with jot's nodes (D34): the record's source view
      // migrated on a scratch copy to the layout this build's pages read,
      // through any gap. Render only: never stored or merged.
      const source = storedSourceView(record.kind, material);
      const complete = source.complete;
      source.doc.destroy();
      let state: Uint8Array;
      try {
        state = recoveryState(
          recordFrom({ ...record, ...material, receivedAt: record.receivedAt }),
          record.base === null ? null : readBase(sql, record.base),
        );
      } catch (error) {
        this.logError(
          'recovery',
          error,
          undefined,
          'the record could not be migrated for its view',
        );
        return new Response('This record cannot be shown.', { status: 422 });
      }
      return new Response(state, {
        headers: {
          'content-type': 'application/octet-stream',
          'x-jot-complete': complete ? '1' : '0',
        },
      });
    }
    return new Response(encodeExport(record, material), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="jot-offline-edits-${seq}.bin"`,
      },
    });
  }

  /**
   * Keeps a client's handoff (its whole material) as one record. The
   * response is the durable acknowledgement (UploadAcknowledgement: scoped
   * to this note, the replica and its source generation, naming the record,
   * its hash and the upload's SHA-256): a Durable Object holds its response
   * until the write is durable. The same upload twice is one record.
   */
  private async upload(request: Request, id: string): Promise<Response> {
    const declared = request.headers.get(UPLOAD_HASH_HEADER);
    const length = Number(request.headers.get('content-length') ?? '0');
    if (length > UPLOAD_MAX_BYTES) {
      return new Response('Too large.', { status: 413 });
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > UPLOAD_MAX_BYTES) {
      return new Response('Too large.', { status: 413 });
    }
    const hash = await sha256Hex(body);
    if (declared !== hash) {
      return new Response('Hash mismatch.', { status: 400 });
    }
    const sql = this.ctx.storage.sql;
    const existing = recordByUpload(sql, hash);
    if (existing !== null) {
      return Response.json(
        acknowledgement(id, existing.replica ?? '', existing.source, existing.hash, hash, {
          seq: existing.seq,
          actionable: existing.actionable,
        }),
      );
    }
    let upload;
    try {
      upload = decodeUpload(body);
      Y.decodeUpdate(upload.snapshot);
      for (const update of upload.queue) {
        Y.decodeUpdate(update);
      }
    } catch {
      return new Response('Malformed upload.', { status: 400 });
    }
    const usage = quarantineUsage(sql);
    if (usage.records >= MAX_RECORDS || usage.bytes + body.byteLength > MAX_RECORD_BYTES) {
      return new Response('The note keeps too many offline edits.', { status: 507 });
    }
    const now = Date.now();
    // The record names the incarnation its generation was made under, when
    // the note can tell from its own transitions (generations are opaque).
    const generation = upload.source.generation;
    const room = this.identity();
    if (
      upload.source.incarnation === null &&
      generation !== null &&
      generation !== UNKNOWN_GENERATION &&
      sameIncarnationSince(sql, generation, room.generation)
    ) {
      upload.source.incarnation = room.incarnation;
    }
    const built = buildRecord(
      {
        kind: 'handoff',
        session: upload.session,
        replica: upload.replica,
        source: upload.source,
        snapshot: upload.snapshot,
        deltas: [],
        queue: upload.queue,
        draft: upload.draft,
        signals: [],
        receivedAt: now,
        clients: upload.clients,
        peers: upload.peers,
      },
      { generation: this.identity().generation, state: Y.encodeStateAsUpdate(this.doc) },
    );
    const seq = this.ctx.storage.transactionSync(() => {
      const s = insertRecord(sql, {
        kind: 'handoff',
        session: upload.session,
        replica: upload.replica,
        source: upload.source,
        base: null,
        receivedAt: now,
        updatedAt: now,
        hash: built.record.hash,
        upload: hash,
        complete: built.record.complete,
        actionable: built.actionable,
        clients: upload.clients,
        newClients: built.newClients,
        peers: upload.peers,
        draft: upload.draft,
        signals: [],
        collisions: [],
        bytes: body.byteLength,
      });
      appendPart(sql, s, 'snapshot', upload.snapshot);
      for (const update of upload.queue) {
        appendPart(sql, s, 'queue', update);
      }
      return s;
    });
    return Response.json(
      acknowledgement(id, upload.replica, upload.source, built.record.hash, hash, {
        seq,
        actionable: built.actionable,
      }),
    );
  }
}

/** The durable acknowledgement of a stored upload (UploadAcknowledgement). */
function acknowledgement(
  room: string,
  replica: string,
  source: { generation: string | null },
  recordHash: string,
  upload: string,
  facts: { seq: number; actionable: boolean },
): UploadAcknowledgement {
  return {
    v: 1,
    room,
    replica,
    sourceGeneration: source.generation ?? UNKNOWN_GENERATION,
    // A record's id is its hash (createYQuarantineRecord's default).
    record: recordHash,
    hash: recordHash,
    upload,
    seq: facts.seq,
    actionable: facts.actionable,
  };
}

/** A record source nobody can name: material from before the fence. */
const UNKNOWN_SOURCE: YRecordSource = {
  incarnation: null,
  generation: null,
  layouts: null,
  schemaVersion: null,
  renderer: null,
};

function sourceOf(handshake: Handshake | null | undefined): YRecordSource {
  if (handshake === null || handshake === undefined) {
    return UNKNOWN_SOURCE;
  }
  return {
    incarnation: null,
    generation: handshake.generation,
    layouts: [handshake.layouts[0], handshake.layouts[1]],
    schemaVersion: null,
    renderer: null,
  };
}

function materialBytes(material: ReturnType<typeof readMaterial>): number {
  return (
    (material.snapshot?.byteLength ?? 0) +
    material.deltas.reduce((n, d) => n + d.byteLength, 0) +
    material.queue.reduce((n, d) => n + d.byteLength, 0)
  );
}

/** A record's lossless export: its facts as JSON, then its parts. */
function encodeExport(
  record: NonNullable<ReturnType<typeof readRecord>>,
  material: ReturnType<typeof readMaterial>,
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, 'jot-offline-edits/1');
  encoding.writeVarString(
    encoder,
    JSON.stringify({
      ...record,
      signals: record.signals.map((s) => ({ ...s, update: [...s.update] })),
      collisions: record.collisions.map((s) => ({ ...s, update: [...s.update] })),
    }),
  );
  encoding.writeVarUint8Array(encoder, material.snapshot ?? new Uint8Array(0));
  for (const list of [material.deltas, material.queue]) {
    encoding.writeVarUint(encoder, list.length);
    for (const part of list) {
      encoding.writeVarUint8Array(encoder, part);
    }
  }
  return encoding.toUint8Array(encoder);
}

function encodeAwarenessMessage(changes: AwarenessChange[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(changes));
  return encoding.toUint8Array(encoder);
}

function encodeSyncMessage(subtype: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, subtype);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function encodeNoteStatus(bytes: number, flags: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_NOTE_STATUS);
  encoding.writeVarUint(encoder, bytes);
  encoding.writeVarUint(encoder, flags);
  return encoding.toUint8Array(encoder);
}

export function encodeFence(verdict: number, generation: string, initialize: boolean): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_NOTE_FENCE);
  encoding.writeVarUint(encoder, verdict);
  encoding.writeVarString(encoder, generation);
  encoding.writeVarUint(encoder, initialize ? 1 : 0);
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
