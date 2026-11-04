/**
 * The recovery handoff (D34): the note moved on while this page held edits
 * made against an earlier generation. The page stops every writer, commits
 * what the editor holds (`binding.quiesce()`), uploads its whole document as
 * one record, and waits for the server's durable acknowledgement before it
 * lets go of anything. Then the page opens the note afresh; the edits wait in
 * the note's offline edits (the recovery view).
 */
import { LAYOUT_VERSION, MIN_LAYOUT, type YBinding } from '@lexical/y';

import {
  encodeUpload,
  recoveryPath,
  sha256Hex,
  UNKNOWN_GENERATION,
  type Upload,
  UPLOAD_HASH_HEADER,
} from '../../shared/fence';
import { SCHEMA_VERSION } from '../../shared/schema';

export type HandoffResult = 'saved' | 'refused';

/** What one upload came to: acknowledged, refused for good, or not reached yet (`later`). */
export type UploadResult = HandoffResult | 'later';

/** Retries back off from 1 s to this, with the same bytes, until the server acknowledges. */
export const HANDOFF_MAX_BACKOFF_MS = 30_000;

/** A random id for this tab's session, in records. */
export function sessionId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const UPLOADED_PREFIX = 'jot:uploaded:';

/** Upload hashes this tab sent for note `id` (sessionStorage: they survive a reload). */
export function uploadedHashes(id: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(`${UPLOADED_PREFIX}${id}`) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((h) => typeof h === 'string') : []);
  } catch {
    return new Set();
  }
}

export function rememberUpload(id: string, hash: string): void {
  try {
    const hashes = [...uploadedHashes(id)].filter((h) => h !== hash);
    hashes.push(hash);
    sessionStorage.setItem(`${UPLOADED_PREFIX}${id}`, JSON.stringify(hashes.slice(-20)));
  } catch {
    // Storage denied: the record still lists as this browser's by client id.
  }
}

export interface UploadDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: UploadDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Uploads `upload` to note `id` until the server acknowledges its hash.
 * Network failures and server errors retry with the same bytes; a refusal
 * (malformed, too large, too many records) ends it: the caller keeps the
 * material.
 */
export async function uploadMaterial(
  id: string,
  upload: Upload,
  deps: UploadDeps = defaultDeps,
  attempts = Infinity,
): Promise<{ result: UploadResult; hash: string }> {
  const body = encodeUpload(upload);
  const hash = await sha256Hex(body);
  let backoff = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await deps.fetch(recoveryPath(id), {
        method: 'POST',
        headers: { [UPLOAD_HASH_HEADER]: hash, 'content-type': 'application/octet-stream' },
        body: body as Uint8Array<ArrayBuffer>,
      });
      if (response.ok) {
        const ack = (await response.json()) as { upload?: unknown };
        if (ack.upload === hash) {
          rememberUpload(id, hash);
          return { result: 'saved', hash };
        }
      } else if (response.status === 400 || response.status === 413 || response.status === 507) {
        await response.body?.cancel();
        return { result: 'refused', hash };
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Offline or a dropped connection: try again.
    }
    if (attempt >= attempts) {
      return { result: 'later', hash };
    }
    await deps.sleep(backoff);
    backoff = Math.min(backoff * 2, HANDOFF_MAX_BACKOFF_MS);
  }
}

export interface HandoffInput {
  noteId: string;
  binding: YBinding;
  /** The generation this page's document belongs to; null if it never synced. */
  generation: string | null;
  /** Every client id that wrote into the document locally. */
  clients: number[];
}

/**
 * Commits what the editor holds and hands the page's whole document off.
 * The caller has stopped the provider and every in-tab writer first.
 */
export async function handOff(
  input: HandoffInput,
  deps: UploadDeps = defaultDeps,
): Promise<HandoffResult> {
  const { state, draft } = input.binding.quiesce();
  const upload: Upload = {
    session: sessionId(),
    replica: 'tab',
    source: {
      incarnation: null,
      generation: input.generation ?? UNKNOWN_GENERATION,
      layouts: [MIN_LAYOUT, LAYOUT_VERSION],
      schemaVersion: SCHEMA_VERSION,
      renderer: 'jot',
    },
    snapshot: state,
    queue: [],
    // Only what the editor could not commit (`differs`) is a draft.
    draft: draft.differs ? { json: draft.json, differs: true } : null,
    clients: input.clients,
    peers: false,
  };
  const { result } = await uploadMaterial(input.noteId, upload, deps);
  return result === 'saved' ? 'saved' : 'refused';
}
