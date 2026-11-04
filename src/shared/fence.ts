/**
 * The generation fence's wire forms (D34), shared by the client and the
 * Durable Object: the handshake a note's socket URL carries, and the envelope
 * a client uploads its offline edits in. No Lexical and no Yjs here.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/**
 * The fence's protocol version, in the `f` query parameter: the handshake's
 * `v` (`@lexical/y/server`'s version 1 handshake).
 */
export const FENCE_VERSION = 1;

/** A generation a replica cannot name: material from before the fence (`@lexical/y/server`'s). */
export const UNKNOWN_GENERATION = 'unknown';

/**
 * What a client says before any sync message (`@lexical/y/server`'s
 * `YSessionHandshake`, version 1, as `@lexical/y`'s layout upgrade handle
 * builds it): the generation its edits were made against (null: none yet;
 * `'unknown'`: a copy from before the fence), whether it holds edits of its
 * own, the layouts its release reads, the layout its seed records and the
 * features it implements.
 */
export interface Handshake {
  v: 1;
  generation: string | null;
  material: boolean;
  layouts: readonly [number, number];
  seed: number;
  /** Absent: none. */
  features?: readonly string[];
}

/** A feature name in the `ft` parameter (comma-separated). */
const FEATURE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** The handshake as query parameters on the note's socket URL. */
export function handshakeParams(handshake: Handshake): Record<string, string> {
  const params: Record<string, string> = {
    f: String(handshake.v),
    g: handshake.generation ?? '',
    m: handshake.material ? '1' : '0',
    lo: String(handshake.layouts[0]),
    hi: String(handshake.layouts[1]),
    seed: String(handshake.seed),
  };
  const features = handshake.features ?? [];
  if (features.length > 0) {
    params.ft = features.join(',');
  }
  return params;
}

function layoutParam(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]{0,3}$/.test(value)) {
    return null;
  }
  return Number(value);
}

/**
 * The handshake a socket URL carries: null when it carries none (a client
 * from before the fence). Throws on a malformed one.
 */
export function parseHandshake(url: URL): Handshake | null {
  const params = url.searchParams;
  if (!params.has('f')) {
    return null;
  }
  const g = params.get('g') ?? '';
  const lo = layoutParam(params.get('lo'));
  const hi = layoutParam(params.get('hi'));
  const seed = layoutParam(params.get('seed'));
  const m = params.get('m');
  const ft = params.get('ft');
  const features = ft === null || ft === '' ? [] : ft.split(',');
  if (
    params.get('f') !== String(FENCE_VERSION) ||
    features.length > 32 ||
    !features.every((f) => FEATURE.test(f)) ||
    g.length > 512 ||
    lo === null ||
    hi === null ||
    seed === null ||
    lo > hi ||
    (m !== '0' && m !== '1')
  ) {
    throw new Error('malformed handshake');
  }
  return {
    v: FENCE_VERSION,
    generation: g === '' ? null : g,
    material: m === '1',
    layouts: [lo, hi],
    seed,
    features,
  };
}

/** Where a replica's material came from (`@lexical/y/server`'s `YRecordSource`). */
export interface UploadSource {
  incarnation: string | null;
  generation: string | null;
  layouts: [number, number] | null;
  schemaVersion: number | null;
  renderer: string | null;
}

/** One replica's material, as a client uploads it (one quarantine record). */
export interface Upload {
  /** This tab's session (random), for the record. */
  session: string;
  /** The replica: `tab` for a page's note, `copy` for a stored copy from an earlier jot. */
  replica: string;
  source: UploadSource;
  /** The replica's whole document (`encodeStateAsUpdate`). */
  snapshot: Uint8Array;
  /** Updates not in the snapshot (jot keeps none; kept for the format). */
  queue: Uint8Array[];
  /** What the editor showed and could not commit, with whether it differs from the document. */
  draft: { json: unknown; differs: boolean } | null;
  /** Every client id the replica wrote under since its last sync. */
  clients: number[];
  /** Whether anything other than the server could have delivered updates to it (jot: never). */
  peers: boolean;
}

/** Uploads larger than this are refused (D16). */
export const UPLOAD_MAX_BYTES = 8_000_000;

export function encodeUpload(upload: Upload): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, FENCE_VERSION);
  encoding.writeVarString(
    encoder,
    JSON.stringify({
      session: upload.session,
      replica: upload.replica,
      source: upload.source,
      clients: upload.clients,
      peers: upload.peers,
      draft: upload.draft,
    }),
  );
  encoding.writeVarUint8Array(encoder, upload.snapshot);
  encoding.writeVarUint(encoder, upload.queue.length);
  for (const update of upload.queue) {
    encoding.writeVarUint8Array(encoder, update);
  }
  return encoding.toUint8Array(encoder);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Decodes an upload; throws on anything malformed (input from strangers). */
export function decodeUpload(bytes: Uint8Array): Upload {
  const decoder = decoding.createDecoder(bytes);
  if (decoding.readVarUint(decoder) !== FENCE_VERSION) {
    throw new Error('unknown upload version');
  }
  const meta: unknown = JSON.parse(decoding.readVarString(decoder));
  const snapshot = decoding.readVarUint8Array(decoder);
  const count = decoding.readVarUint(decoder);
  if (count > 1000) {
    throw new Error('too many queued updates');
  }
  const queue: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    queue.push(decoding.readVarUint8Array(decoder));
  }
  if (decoding.hasContent(decoder)) {
    throw new Error('trailing bytes in upload');
  }
  if (typeof meta !== 'object' || meta === null) {
    throw new Error('malformed upload');
  }
  const { session, replica, source, clients, peers, draft } = meta as Record<string, unknown>;
  const src = (source ?? {}) as Record<string, unknown>;
  const layouts = src.layouts;
  if (
    typeof session !== 'string' ||
    session.length > 64 ||
    typeof replica !== 'string' ||
    replica.length > 64 ||
    !isStringOrNull(src.incarnation) ||
    !isStringOrNull(src.generation) ||
    !isStringOrNull(src.renderer) ||
    !(src.schemaVersion === null || Number.isSafeInteger(src.schemaVersion)) ||
    !(
      layouts === null ||
      (Array.isArray(layouts) && layouts.length === 2 && layouts.every(Number.isSafeInteger))
    ) ||
    !Array.isArray(clients) ||
    clients.length > 10_000 ||
    !clients.every((c) => Number.isSafeInteger(c)) ||
    typeof peers !== 'boolean' ||
    !(
      draft === null ||
      (typeof draft === 'object' && typeof (draft as { differs?: unknown }).differs === 'boolean')
    )
  ) {
    throw new Error('malformed upload');
  }
  return {
    session,
    replica,
    source: {
      incarnation: src.incarnation as string | null,
      generation: src.generation as string | null,
      layouts: layouts as [number, number] | null,
      schemaVersion: src.schemaVersion as number | null,
      renderer: src.renderer as string | null,
    },
    snapshot,
    queue,
    draft: draft as Upload['draft'],
    clients: clients as number[],
    peers,
  };
}

/** The SHA-256 of `bytes` in hex: what an upload's acknowledgement names. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The server's durable acknowledgement of an upload: `@lexical/y/server`'s
 * `YRecordAcknowledgement` (version 1: the room, replica and source
 * generation it is scoped to, the record and its hash), plus the upload's
 * SHA-256, the record's seq and whether it holds anything new.
 */
export interface UploadAcknowledgement {
  v: 1;
  room: string;
  replica: string;
  sourceGeneration: string;
  record: string;
  hash: string;
  upload: string;
  seq: number;
  actionable: boolean;
}

/**
 * Whether `ack` acknowledges exactly the upload this replica sent: every
 * scope field matches, and it names the exact bytes (their SHA-256). A bare
 * hash, or an acknowledgement for another note, replica or generation, or of
 * another version, acknowledges nothing: the replica keeps its material.
 */
export function acknowledges(
  ack: unknown,
  sent: { room: string; replica: string; sourceGeneration: string; upload: string },
): boolean {
  if (typeof ack !== 'object' || ack === null) {
    return false;
  }
  const a = ack as Partial<Record<keyof UploadAcknowledgement, unknown>>;
  return (
    a.v === 1 &&
    a.room === sent.room &&
    a.replica === sent.replica &&
    a.sourceGeneration === sent.sourceGeneration &&
    a.upload === sent.upload &&
    typeof a.record === 'string' &&
    typeof a.hash === 'string'
  );
}

/** The header an upload names its hash in; the server checks it. */
export const UPLOAD_HASH_HEADER = 'x-jot-upload-sha256';

/** A note's recovery endpoints, relative to the origin. */
export function recoveryPath(id: string, rest = ''): string {
  return `/api/n/${id}/recovery${rest}`;
}

/** A record as the recovery list shows it. */
export interface RecoveryListItem {
  seq: number;
  kind: 'handoff' | 'capture' | 'pending';
  replica: string | null;
  receivedAt: number;
  actionable: boolean;
  complete: boolean;
  /** Client ids of the record's own structs (what "yours" matches). */
  clients: number[];
  /** The upload's SHA-256 (handoffs) or null (captures). */
  upload: string | null;
  bytes: number;
  /** What the replay did with it (D34), null when it was not replayed. */
  replay: { eligible: boolean; applied: number; conflicts: number } | null;
}
