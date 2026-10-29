# D29: One app schema version for every note, raised when older jot can't keep a note

Status: `DECIDED`

## Context

`@lexical/y` now takes a required `schemaVersion`: the app's version of what it stores. A
client records its version on the note with its first write (`lexical-y-schema:<n>` on the
root, grow-only), and a client whose version is lower than the highest recorded opens the
note read only and reports `UNSUPPORTED_SCHEMA_WARNING`, instead of editing over content it
can't keep (a node type it doesn't register, a stored state it doesn't know).

jot deploys on every push to `main` (D10), so a tab opened before a deploy keeps running the
older jot beside newer ones on the same note.

## Decision

- jot has one schema version, `SCHEMA_VERSION` in `src/shared/schema.ts`, starting at `1`.
  The page's editor, the in-tab peers and the docs inspector all bind with it.
- Raise it in the release that first writes something the previous jot can't keep: a new
  node type, a new kind of stored state, a changed meaning for an existing one. Changes that
  older jot reads correctly (styling, chrome, behaviour) leave it alone.
- An older tab that meets a newer note shows the existing banner, "Read only. This note was
  written by a newer version of jot; reload to edit." Reloading loads the newer jot.

## Why

- One number is enough for a single deployed app; per-feature versions would buy nothing.
- Read only is what D25 already does for a newer layout; the same banner and the same
  promise cover both.

## Consequences

- Forgetting to raise it lets an older tab rewrite what it can't read, as before this
  version existed. Raising it needlessly only costs older tabs a reload.
- The version never goes down: a note a newer jot wrote stays read only in older ones.
