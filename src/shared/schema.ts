/**
 * The app schema version jot records in every note it writes (`@lexical/y`'s
 * `schemaVersion`). Raise it in the release that first writes something an older jot
 * can't keep: a new node type, or a changed stored state. A tab still running the older
 * jot then opens the notes the newer one wrote read only, with the reload banner, instead
 * of editing over what it can't read (D29).
 */
export const SCHEMA_VERSION = 1;
