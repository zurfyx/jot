/**
 * Reading a quarantine record as the editor would show it (D34), in the
 * page, in a chunk that loads only when the recovery view opens: the note's
 * Durable Object stays Yjs-only, and the note page carries none of this.
 * R reads only layouts its own binding reads; R+1 migrates a scratch copy
 * first (the runner and the steps join this chunk then).
 */
import { readYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import { $getEditor, type SerializedEditorState } from 'lexical';

import { jotNodesExtension } from '../../../shared/nodes';
import { SCHEMA_VERSION } from '../../../shared/schema';

const SCHEMA_PREFIX = 'lexical-y-schema:';

/**
 * The schema version to read a source view with: jot's own, or the highest
 * the view records when that is higher (a legacy signal records one above
 * every version; the record's exact signal items are excluded from what
 * counts as the replica's edits, and this keeps a stray one from making the
 * read refuse).
 */
export function readSchemaVersion(attrs: Record<string, unknown>): number {
  let version = SCHEMA_VERSION;
  for (const key of Object.keys(attrs)) {
    if (key.startsWith(SCHEMA_PREFIX)) {
      const n = Number(key.slice(SCHEMA_PREFIX.length));
      if (Number.isSafeInteger(n) && n > version) {
        version = n;
      }
    }
  }
  return version;
}

export type Rendered =
  { ok: true; editorState: SerializedEditorState } | { ok: false; reason: string };

/** A record's source view (its whole state, as the server built it) as Lexical JSON, or why not. */
export function renderView(state: Uint8Array): Rendered {
  const doc = new Y.Doc({ gc: false });
  let schemaVersion: number;
  try {
    Y.applyUpdate(doc, state);
    schemaVersion = readSchemaVersion(doc.get('lexical-y').getAttrs() as Record<string, unknown>);
  } catch (error) {
    return { ok: false, reason: String(error) };
  } finally {
    doc.destroy();
  }
  try {
    const editorState = readYState(state, { extensions: [jotNodesExtension], schemaVersion }, () =>
      $getEditor().getEditorState().toJSON(),
    );
    return { ok: true, editorState };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}
