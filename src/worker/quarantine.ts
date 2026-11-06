/**
 * NoteRoom's fence storage (D34), beside the `note` row: the room's
 * incarnation, the immutable bases a migration keeps, and the quarantine of
 * edits made against another generation. Cloudflare caps a row (and a BLOB)
 * at 2 MB, so material is stored in parts of at most PART_BYTES.
 */
import type { YLegacySignal, YRecordSource } from './library';

/** The largest BLOB one row holds here, under Cloudflare's 2 MB row cap. */
export const PART_BYTES = 1_900_000;

/** Records are kept at least this long (the quarantine window), then pruned. */
export const RECORD_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Per-note limits on the quarantine (D16): past them, uploads are refused (507). */
export const MAX_RECORDS = 256;
export const MAX_RECORD_BYTES = 64_000_000;

export function ensureFenceSchema(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS room (
    id INTEGER PRIMARY KEY CHECK (id = 0),
    incarnation TEXT NOT NULL,
    inherited INTEGER NOT NULL,
    seed_contract INTEGER NOT NULL,
    generation TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS bases (
    generation TEXT PRIMARY KEY,
    incarnation TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS base_parts (
    generation TEXT NOT NULL,
    chunk INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (generation, chunk)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    session TEXT,
    replica TEXT,
    source TEXT NOT NULL,
    base TEXT,
    received_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    hash TEXT NOT NULL,
    upload TEXT UNIQUE,
    complete INTEGER NOT NULL,
    actionable INTEGER NOT NULL,
    clients TEXT NOT NULL,
    new_clients TEXT NOT NULL,
    peers INTEGER NOT NULL,
    draft TEXT,
    signals TEXT NOT NULL,
    collisions TEXT NOT NULL,
    bytes INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS record_parts (
    seq INTEGER NOT NULL,
    n INTEGER NOT NULL,
    part TEXT NOT NULL,
    chunk INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (seq, n, chunk)
  )`);
}

export interface RoomRow {
  incarnation: string;
  inherited: boolean;
  seedContract: number;
  /**
   * The generation the room serves, stored: never recomputed from the
   * document per update, where a client could write an epoch attribute.
   */
  generation: string;
  createdAt: number;
}

export function readRoom(sql: SqlStorage): RoomRow | null {
  const rows = sql
    .exec<{
      incarnation: string;
      inherited: number;
      seed_contract: number;
      generation: string;
      created_at: number;
    }>(
      'SELECT incarnation, inherited, seed_contract, generation, created_at FROM room WHERE id = 0',
    )
    .toArray();
  const row = rows[0];
  return row === undefined
    ? null
    : {
        incarnation: row.incarnation,
        inherited: row.inherited === 1,
        seedContract: row.seed_contract,
        generation: row.generation,
        createdAt: row.created_at,
      };
}

export function writeRoom(sql: SqlStorage, room: RoomRow): void {
  sql.exec(
    `INSERT INTO room (id, incarnation, inherited, seed_contract, generation, created_at)
     VALUES (0, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET incarnation = excluded.incarnation,
       inherited = excluded.inherited, seed_contract = excluded.seed_contract,
       generation = excluded.generation, created_at = excluded.created_at`,
    room.incarnation,
    room.inherited ? 1 : 0,
    room.seedContract,
    room.generation,
    room.createdAt,
  );
}

/** A fresh incarnation: 128 random bits, base64url. Never reused. */
export function newIncarnation(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type PartKind = 'snapshot' | 'delta' | 'queue';

export interface StoredRecord {
  seq: number;
  kind: 'handoff' | 'capture' | 'pending';
  session: string | null;
  replica: string | null;
  source: YRecordSource;
  base: string | null;
  receivedAt: number;
  updatedAt: number;
  hash: string;
  upload: string | null;
  complete: boolean;
  actionable: boolean;
  clients: number[];
  newClients: number[];
  peers: boolean;
  draft: { json: unknown; differs: boolean } | null;
  signals: YLegacySignal[];
  collisions: YLegacySignal[];
  bytes: number;
}

type RecordRow = {
  seq: number;
  kind: string;
  session: string | null;
  replica: string | null;
  source: string;
  base: string | null;
  received_at: number;
  updated_at: number;
  hash: string;
  upload: string | null;
  complete: number;
  actionable: number;
  clients: string;
  new_clients: string;
  peers: number;
  draft: string | null;
  signals: string;
  collisions: string;
  bytes: number;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function encodeSignals(signals: readonly YLegacySignal[]): string {
  return JSON.stringify(signals.map((s) => ({ ...s, update: toBase64(s.update) })));
}

export function decodeSignals(text: string): YLegacySignal[] {
  const raw = JSON.parse(text) as (Omit<YLegacySignal, 'update'> & { update: string })[];
  return raw.map((s) => ({ ...s, update: fromBase64(s.update) }));
}

function fromRow(row: RecordRow): StoredRecord {
  return {
    seq: row.seq,
    kind: row.kind as StoredRecord['kind'],
    session: row.session,
    replica: row.replica,
    source: JSON.parse(row.source) as YRecordSource,
    base: row.base,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
    hash: row.hash,
    upload: row.upload,
    complete: row.complete === 1,
    actionable: row.actionable === 1,
    clients: JSON.parse(row.clients) as number[],
    newClients: JSON.parse(row.new_clients) as number[],
    peers: row.peers === 1,
    draft: row.draft === null ? null : (JSON.parse(row.draft) as StoredRecord['draft']),
    signals: decodeSignals(row.signals),
    collisions: decodeSignals(row.collisions),
    bytes: row.bytes,
  };
}

export type NewRecord = Omit<StoredRecord, 'seq'>;

/** Inserts a record's row (its parts go in with appendPart); returns its seq. */
export function insertRecord(sql: SqlStorage, record: NewRecord): number {
  const row = sql
    .exec<{ seq: number }>(
      `INSERT INTO records (kind, session, replica, source, base, received_at, updated_at, hash,
        upload, complete, actionable, clients, new_clients, peers, draft, signals, collisions, bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
      record.kind,
      record.session,
      record.replica,
      JSON.stringify(record.source),
      record.base,
      record.receivedAt,
      record.updatedAt,
      record.hash,
      record.upload,
      record.complete ? 1 : 0,
      record.actionable ? 1 : 0,
      JSON.stringify(record.clients),
      JSON.stringify(record.newClients),
      record.peers ? 1 : 0,
      record.draft === null ? null : JSON.stringify(record.draft),
      encodeSignals(record.signals),
      encodeSignals(record.collisions),
      record.bytes,
    )
    .one();
  return row.seq;
}

/** Updates what a record's material decides (it grows while a legacy session sends deltas). */
export function updateRecordFacts(
  sql: SqlStorage,
  seq: number,
  facts: Pick<
    StoredRecord,
    | 'hash'
    | 'complete'
    | 'actionable'
    | 'newClients'
    | 'signals'
    | 'collisions'
    | 'bytes'
    | 'updatedAt'
  >,
): void {
  sql.exec(
    `UPDATE records SET hash = ?, complete = ?, actionable = ?, new_clients = ?, signals = ?,
       collisions = ?, bytes = ?, updated_at = ? WHERE seq = ?`,
    facts.hash,
    facts.complete ? 1 : 0,
    facts.actionable ? 1 : 0,
    JSON.stringify(facts.newClients),
    encodeSignals(facts.signals),
    encodeSignals(facts.collisions),
    facts.bytes,
    facts.updatedAt,
    seq,
  );
}

/** Appends one part (a snapshot, delta or queued update), split under the row cap. */
export function appendPart(sql: SqlStorage, seq: number, part: PartKind, data: Uint8Array): void {
  const next = sql
    .exec<{ n: number | null }>('SELECT MAX(n) AS n FROM record_parts WHERE seq = ?', seq)
    .one().n;
  const n = next === null ? 0 : next + 1;
  for (let chunk = 0, at = 0; at < data.byteLength || chunk === 0; chunk++, at += PART_BYTES) {
    const slice = data.subarray(at, Math.min(at + PART_BYTES, data.byteLength));
    sql.exec(
      'INSERT INTO record_parts (seq, n, part, chunk, data) VALUES (?, ?, ?, ?, ?)',
      seq,
      n,
      part,
      chunk,
      slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
    );
  }
}

export interface RecordMaterial {
  snapshot: Uint8Array | null;
  deltas: Uint8Array[];
  queue: Uint8Array[];
}

/** A record's parts, joined, in order. */
export function readMaterial(sql: SqlStorage, seq: number): RecordMaterial {
  const rows = sql
    .exec<{ n: number; part: string; chunk: number; data: ArrayBuffer }>(
      'SELECT n, part, chunk, data FROM record_parts WHERE seq = ? ORDER BY n, chunk',
      seq,
    )
    .toArray();
  const parts: { part: string; chunks: Uint8Array[] }[] = [];
  let current = -1;
  for (const row of rows) {
    if (row.n !== current) {
      current = row.n;
      parts.push({ part: row.part, chunks: [] });
    }
    parts[parts.length - 1]!.chunks.push(new Uint8Array(row.data));
  }
  const material: RecordMaterial = { snapshot: null, deltas: [], queue: [] };
  for (const { part, chunks } of parts) {
    const size = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const joined = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.byteLength;
    }
    if (part === 'snapshot') {
      material.snapshot = joined;
    } else if (part === 'delta') {
      material.deltas.push(joined);
    } else {
      material.queue.push(joined);
    }
  }
  return material;
}

export function readRecord(sql: SqlStorage, seq: number): StoredRecord | null {
  const row = sql.exec<RecordRow>('SELECT * FROM records WHERE seq = ?', seq).toArray()[0];
  return row === undefined ? null : fromRow(row);
}

export function recordByUpload(sql: SqlStorage, upload: string): StoredRecord | null {
  const row = sql.exec<RecordRow>('SELECT * FROM records WHERE upload = ?', upload).toArray()[0];
  return row === undefined ? null : fromRow(row);
}

export function listRecords(sql: SqlStorage): StoredRecord[] {
  return sql.exec<RecordRow>('SELECT * FROM records ORDER BY seq').toArray().map(fromRow);
}

/** How many records and bytes the quarantine holds (for the limits). */
export function quarantineUsage(sql: SqlStorage): { records: number; bytes: number } {
  const row = sql
    .exec<{ n: number; bytes: number | null }>(
      'SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM records',
    )
    .one();
  return { records: row.n, bytes: row.bytes ?? 0 };
}

/**
 * Drops records past the quarantine window, and bases no remaining record
 * references that are past it too.
 */
export function pruneQuarantine(sql: SqlStorage, now: number): void {
  const cutoff = now - RECORD_RETENTION_MS;
  sql.exec(
    'DELETE FROM record_parts WHERE seq IN (SELECT seq FROM records WHERE received_at < ?)',
    cutoff,
  );
  sql.exec('DELETE FROM records WHERE received_at < ?', cutoff);
  sql.exec(
    `DELETE FROM base_parts WHERE generation IN (SELECT generation FROM bases WHERE created_at < ?
       AND generation NOT IN (SELECT base FROM records WHERE base IS NOT NULL))`,
    cutoff,
  );
  sql.exec(
    `DELETE FROM bases WHERE created_at < ?
       AND generation NOT IN (SELECT base FROM records WHERE base IS NOT NULL)`,
    cutoff,
  );
}
