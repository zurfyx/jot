/**
 * Size and lifetime limits (D05, D06), shared by the client and the Durable
 * Object so both sides agree on when a note is full.
 */

/**
 * A note's stored Yjs state may not exceed this many bytes. The state is
 * stored as one SQLite row, and Cloudflare caps a row at 2 MB.
 */
export const NOTE_MAX_BYTES = 2_000_000;

/** At this size the client shows "This note is almost full". */
export const NOTE_WARN_BYTES = 1_600_000;

/** A note is deleted after this long without a visit (D06). */
export const NOTE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

/** The Durable Object saves this long after the first unsaved change. */
export const SAVE_DEBOUNCE_MS = 2_000;

export type CapState = 'ok' | 'warn' | 'full';

/** Where a note of `bytes` stands against the cap. */
export function capState(bytes: number): CapState {
  if (bytes >= NOTE_MAX_BYTES) {
    return 'full';
  }
  if (bytes >= NOTE_WARN_BYTES) {
    return 'warn';
  }
  return 'ok';
}

/**
 * Whether an update of `updateBytes` may be applied to a note whose state is
 * `stateBytes`, judged by an upper bound: applying an update grows the encoded
 * state by at most the update's length plus a little struct overhead. When the
 * bound fails, the server measures exactly before rejecting (see NoteRoom).
 */
export const UPDATE_OVERHEAD_BYTES = 64;

export function fitsUnderCap(stateBytes: number, updateBytes: number): boolean {
  return stateBytes + updateBytes + UPDATE_OVERHEAD_BYTES <= NOTE_MAX_BYTES;
}
