/**
 * Shadow receipts (D34): a dry run of the layout 3 migration on real notes,
 * writing nothing. Once per Durable Object instance, a note that is opened
 * is migrated on a copy and the receipt is logged; the stored note, its
 * generation and every client are untouched. Off unless the Worker's
 * `JOT_SHADOW_RECEIPTS` var is `"1"`.
 */
import { migrateYState, type YMigrationReceipt } from '@lexical/y/migrate';

import { LAYOUT_STEPS, SHADOW_LAYOUT } from './steps';

/** Notes larger than this are skipped (their CPU cost is not measured yet). */
export const SHADOW_MAX_BYTES = 1_000_000;

export interface ShadowReceipt {
  note: string;
  ok: boolean;
  skipped?: 'size';
  bytesBefore: number;
  bytesAfter?: number;
  ms?: number;
  from?: number | null;
  changed?: boolean;
  pending?: number;
  problems?: string;
}

/** A short, non-reversible tag for a note in logs: the link is the key (D02). */
export async function noteTag(noteId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(noteId));
  return [...new Uint8Array(digest).slice(0, 6)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Migrates a copy of `state` to the layout the last bundled step reaches
 * (`to` explicitly: this release's MIN_LAYOUT is 1, so the default target
 * would make every receipt a no-op) and reports what happened. Never throws.
 */
export function shadowReceipt(note: string, state: Uint8Array): ShadowReceipt {
  if (state.byteLength > SHADOW_MAX_BYTES) {
    return { note, ok: true, skipped: 'size', bytesBefore: state.byteLength };
  }
  const started = Date.now();
  try {
    const result = migrateYState(state, LAYOUT_STEPS, {
      roots: ['lexical-y'],
      to: SHADOW_LAYOUT,
    });
    const receipt: YMigrationReceipt = result.receipt;
    return {
      note,
      ok: true,
      bytesBefore: state.byteLength,
      bytesAfter: result.state.byteLength,
      ms: Date.now() - started,
      from: receipt.roots[0]?.from ?? null,
      changed: receipt.changed,
      pending: result.pending?.byteLength ?? 0,
    };
  } catch (error) {
    return {
      note,
      ok: false,
      bytesBefore: state.byteLength,
      ms: Date.now() - started,
      problems: String(error).slice(0, 2000),
    };
  }
}
