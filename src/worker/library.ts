/**
 * The `@lexical/y/server` pieces NoteRoom uses, behind one small adapter
 * (D34), so a change in the library's fence API lands here, not in room.ts.
 */
import {
  checkYSession,
  createYDoc,
  describeYRoom,
  generationOf,
  hasNewYEdits,
  legacySignal,
  needsNewIncarnation,
  quarantineRecord,
  sourceView,
  type YLegacySignal,
  type YQuarantineRecord,
  type YRecordSource,
  type YRoomDescription,
  type YSessionVerdict,
  SEED_LAYOUT,
} from '@lexical/y/server';
import type * as Y from '@y/y';

import type { Handshake } from '../shared/fence';

export type { YLegacySignal, YQuarantineRecord, YRecordSource, YRoomDescription, YSessionVerdict };
export { createYDoc, generationOf, hasNewYEdits, legacySignal, SEED_LAYOUT, sourceView };

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

/** Whether a pristine room issued under another seed contract needs a new incarnation. */
export function replaceIncarnation(room: YRoomDescription, seedLayout: number): boolean {
  return needsNewIncarnation(room, seedLayout);
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
 * arrives; R keeps no base, so nothing the room already holds is new).
 */
export function buildRecord(input: RecordInput, live: Uint8Array): BuiltRecord {
  const record = quarantineRecord({
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
  return {
    record,
    newClients: newClientsOf(record, live),
    clients: input.clients,
    peers: input.peers,
    actionable: hasNewYEdits(record, live),
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
