import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

/**
 * The server half of y-protocols awareness, without the `Awareness` class:
 * that class runs a timer, which would keep the Durable Object from
 * hibernating. The relay keeps the last state of each client, forwards
 * updates, and announces a client's removal when its socket closes. Clients
 * time out stale states on their own.
 */

export interface AwarenessEntry {
  clock: number;
  /** The state as the client sent it: JSON text, `null` for a removal. */
  state: string;
}

export interface AwarenessChange {
  clientID: number;
  clock: number;
  state: string;
}

/** Decodes an awareness update. Throws on malformed input. */
export function decodeAwarenessUpdate(update: Uint8Array): AwarenessChange[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const changes: AwarenessChange[] = [];
  for (let i = 0; i < count; i++) {
    const clientID = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = decoding.readVarString(decoder);
    // A state is JSON; reject anything else before relaying it to peers.
    JSON.parse(state);
    changes.push({ clientID, clock, state });
  }
  if (decoding.hasContent(decoder)) {
    throw new Error('trailing bytes in awareness update');
  }
  return changes;
}

export function encodeAwarenessUpdate(changes: AwarenessChange[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, changes.length);
  for (const { clientID, clock, state } of changes) {
    encoding.writeVarUint(encoder, clientID);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, state);
  }
  return encoding.toUint8Array(encoder);
}

export class AwarenessRelay {
  readonly states = new Map<number, AwarenessEntry>();

  /**
   * Records an update and returns the changes that are newer than what the
   * relay knew (the same rule as y-protocols' applyAwarenessUpdate).
   */
  apply(changes: AwarenessChange[]): AwarenessChange[] {
    const accepted: AwarenessChange[] = [];
    for (const change of changes) {
      const current = this.states.get(change.clientID);
      const removal = change.state === 'null';
      if (current === undefined || current.clock < change.clock) {
        accepted.push(change);
      } else if (current.clock === change.clock && removal && current.state !== 'null') {
        accepted.push(change);
      } else {
        continue;
      }
      if (removal) {
        this.states.delete(change.clientID);
      } else {
        this.states.set(change.clientID, { clock: change.clock, state: change.state });
      }
    }
    return accepted;
  }

  /** Removal changes for clients that left, given their last known clocks. */
  remove(clocks: Record<string, number>): AwarenessChange[] {
    const changes: AwarenessChange[] = [];
    for (const [key, knownClock] of Object.entries(clocks)) {
      const clientID = Number(key);
      const clock = Math.max(knownClock, this.states.get(clientID)?.clock ?? 0) + 1;
      this.states.delete(clientID);
      changes.push({ clientID, clock, state: 'null' });
    }
    return changes;
  }

  /** Every known state, for a client that just connected. */
  snapshot(): AwarenessChange[] {
    return [...this.states].map(([clientID, { clock, state }]) => ({ clientID, clock, state }));
  }
}
