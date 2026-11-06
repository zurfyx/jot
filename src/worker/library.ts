/**
 * The `@lexical/y/server` pieces NoteRoom uses, behind one small adapter
 * (D34), so a change in the library's fence API lands here, not in room.ts.
 */
import {
  checkYSession,
  createYDoc,
  createYQuarantineRecord,
  createYSessionCapture,
  describeYRoom,
  getYGeneration,
  prepareYRoom,
  sourceView,
  type YPreparedRoom,
  type YLegacySignal,
  type YQuarantineRecord,
  type YRecordSource,
  type YRoomDescription,
  type YSessionVerdict,
  SEED_LAYOUT,
} from '@lexical/y/server';
import { migrateYState } from '@lexical/y/migrate';
import * as Y from '@y/y';

import type { Handshake } from '../shared/fence';

import { LAYOUT_STEPS } from './steps';

export type {
  YLegacySignal,
  YPreparedRoom,
  YQuarantineRecord,
  YRecordSource,
  YRoomDescription,
  YSessionVerdict,
};
export { createYDoc, getYGeneration, SEED_LAYOUT };

/** A record's material as NoteRoom stores it (record_parts). */
export interface StoredMaterial {
  snapshot: Uint8Array | null;
  deltas: Uint8Array[];
  queue: Uint8Array[];
}

/**
 * The source view of a record NoteRoom stored. NoteRoom stores only records
 * it built with this release (version 1, update format `'yjs-v1'`, no
 * feature requirement), so it names that header; the library refuses any
 * other before reading a byte.
 */
export function storedSourceView(kind: string, material: StoredMaterial) {
  return sourceView({
    v: 1,
    updateFormat: 'yjs-v1',
    kind,
    requires: [],
    snapshot: material.snapshot,
    deltas: material.deltas,
    queue: material.queue,
  });
}

/** An empty Yjs update: the snapshot of a session that sent none. */
const EMPTY_UPDATE = new Uint8Array([0, 0]);

/**
 * The update that turns a client from before the fence read only, built on
 * the material NoteRoom keeps for its session (a hibernating Durable Object
 * keeps the material, not the capture object). The capture also lists the
 * signals the session wrote other content at (`collisions`).
 */
export function captureOf(material: StoredMaterial, signals: readonly YLegacySignal[]) {
  return createYSessionCapture({
    v: 1,
    updateFormat: 'yjs-v1',
    snapshot: material.snapshot ?? EMPTY_UPDATE,
    deltas: [...material.deltas, ...material.queue],
    signals,
  });
}

/** The roots NoteRoom serves: the editor's. `jot-people` is not a Lexical root. */
export const SERVED_ROOTS = ['lexical-y'] as const;

export interface RoomIdentity {
  incarnation: string;
  inherited: boolean;
  seedContract: number;
}

/** The room as the handshake verdict sees it. */
export function describeRoom(doc: Y.Doc, room: RoomIdentity): YRoomDescription {
  return describeYRoom(doc, {
    incarnation: room.incarnation,
    inherited: room.inherited,
    seedContract: room.seedContract,
    roots: SERVED_ROOTS,
  });
}

/** The verdict for a session: `handshake` null for a client from before the fence. */
export function verdictFor(room: YRoomDescription, handshake: Handshake | null): YSessionVerdict {
  return checkYSession(room, handshake);
}

/**
 * Whether a pristine room issued under another seed contract needs a new
 * incarnation (y-server.md: a pristine room whose seed contract is not this
 * release's SEED_LAYOUT).
 */
export function replaceIncarnation(room: YRoomDescription, seedLayout: number): boolean {
  return room.pristine && room.seedContract !== seedLayout;
}

export interface RecordInput {
  kind: YQuarantineRecord['kind'];
  session: string | null;
  replica: string | null;
  source: YRecordSource;
  snapshot: Uint8Array | null;
  deltas: Uint8Array[];
  queue: Uint8Array[];
  draft: YQuarantineRecord['draft'];
  signals: YLegacySignal[];
  receivedAt: number;
  /** Every client id the replica wrote under since its last sync (the client's word). */
  clients: number[];
  /** Whether anything but the server could have delivered updates to it. */
  peers: boolean;
}

/** A record as NoteRoom stores it: the library's, plus what it does not carry yet. */
export interface BuiltRecord {
  record: YQuarantineRecord;
  /** The client ids of the source view's own structs that `live` lacks. */
  newClients: number[];
  clients: number[];
  peers: boolean;
  actionable: boolean;
}

/**
 * Builds a record and judges it against `live` (the room's state when it
 * arrives, under its generation; R keeps no base, so nothing the room already
 * holds is new).
 */
export function buildRecord(
  input: RecordInput,
  live: { generation: string; state: Uint8Array },
): BuiltRecord {
  const record = createYQuarantineRecord(
    {
      kind: input.kind,
      session: input.session,
      replica: input.replica,
      peers: input.peers,
      clients: input.clients,
      source: input.source,
      snapshot: input.snapshot,
      deltas: input.deltas,
      queue: input.queue,
      draft: input.draft,
      signals: input.signals,
      receivedAt: input.receivedAt,
    },
    live,
  );
  return {
    record,
    newClients: newClientsOf(record, live.state),
    clients: input.clients,
    peers: input.peers,
    actionable: record.actionable,
  };
}

/** Client ids holding structs the live state lacks, signals excluded. */
function newClientsOf(record: YQuarantineRecord, live: Uint8Array): number[] {
  const view = sourceView(record);
  const was = createYDoc(live, { gc: false });
  try {
    const signalClients = new Set(record.signals.map((s) => s.client));
    const out: number[] = [];
    for (const [client, structs] of view.doc.store.clients) {
      const last = structs[structs.length - 1];
      if (last === undefined || signalClients.has(client)) {
        continue;
      }
      if (last.id.clock + last.length > was.store.getClock(client)) {
        out.push(client);
      }
    }
    return out.sort((a, b) => a - b);
  } finally {
    was.destroy();
    view.doc.destroy();
  }
}

/**
 * The load-time migration of a note's sealed state (D34): every served root
 * below `floor` is migrated in place with the Worker's steps. A no-op when
 * none is (nothing to store). Throws a YMigrationError when a root is
 * refused or a check fails.
 */
export function prepareNote(state: Uint8Array, incarnation: string, floor: number): YPreparedRoom {
  return prepareYRoom(state, {
    steps: LAYOUT_STEPS,
    incarnation,
    roots: SERVED_ROOTS,
    gc: true,
    to: floor,
  });
}

/** The quarantine record of the pending material a migration split out. */
export function pendingRecord(
  stored: Uint8Array,
  pending: Uint8Array,
  source: YRecordSource,
  migrated: { generation: string; state: Uint8Array },
): BuiltRecord {
  const record = createYQuarantineRecord(
    { kind: 'pending', stored, pending, source, receivedAt: Date.now() },
    migrated,
  );
  return {
    record,
    newClients: newClientsOf(record, migrated.state),
    clients: [],
    peers: true,
    actionable: record.actionable,
  };
}

/** A stored record's library form (rebuilt from its row and parts). */
export function recordFrom(input: RecordInput): YQuarantineRecord {
  return createYQuarantineRecord({
    kind: input.kind,
    session: input.session,
    replica: input.replica,
    peers: input.peers,
    clients: input.clients,
    source: input.source,
    snapshot: input.snapshot,
    deltas: input.deltas,
    queue: input.queue,
    draft: input.draft,
    signals: input.signals,
    receivedAt: input.receivedAt,
  });
}

/**
 * The state the recovery view renders for a record: its source view migrated
 * on a scratch copy to the layout this build's clients read, through any
 * gap. Render only: never stored, sent into the note or merged.
 */
export function recoveryState(record: YQuarantineRecord, base: Uint8Array | null): Uint8Array {
  const view = sourceView(record);
  try {
    // A record missing a dependency (a pending record's skipped range) renders
    // over its base, the state of the generation it was made against.
    if (!view.complete && base !== null) {
      Y.applyUpdate(view.doc, base);
    }
    // Every root of a scratch copy migrated to this build's floor (layout 3);
    // anything the migration splits out is not rendered.
    return migrateYState(Y.encodeStateAsUpdate(view.doc), LAYOUT_STEPS, {
      roots: SERVED_ROOTS,
      gc: false,
    }).state;
  } finally {
    view.doc.destroy();
  }
}
