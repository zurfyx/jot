# D36: Notes move to `@lexical/y` layout 4, migrated on their first open

Status: `PROPOSED`

## Context

meta/lexical `main` at `85d811d` stores NodeState values on text as paired runs, as layout
3 already stores formats, links and comment ids (layout 4, meta/lexical#9884). Its
`@lexical/y` reads and writes layout 4 only (`MIN_LAYOUT`, `LAYOUT_VERSION` and
`SEED_LAYOUT` are 4) and ships the frozen step `@lexical/y/migrate/3to4`. Every live jot
note is at layout 3, written by the release before. The same range removes `clientIDRange`
(jot never set it), adds `QuoteContainerNode` (experimental), `@lexical/y/offline` and a
new binding setup API beside the existing one.

D34's migration on first open is the path a layout change takes: the note's object migrates
it in place before serving it, and the generation fence keeps pages of the earlier release
out of the migrated note.

## Decision

- jot pins `85d811d` (D04) and moves to layout 4. The Worker bundles `1to2`, `2to3` and
  `3to4` (`src/worker/steps.ts`) and its floor is the library's `MIN_LAYOUT`, 4: every note
  below it migrates in place on its first open after the deploy, as D34 describes.
- jot's schema version stays 1 (D29): jot writes no new node type or stored state. Pages of
  the earlier release are kept out by layout through the fence, not by schema version.
- A layout 3 note's migration is tested on states that release seeded and edited with jot's
  node set (`src/shared/testing/layout3.ts`, generated once): the migrated note reads
  exactly as that release read it, and every character, marker and node keeps its Yjs id.
- Not adopted here: `QuoteContainerNode` (a quote stored as a container: every stored quote,
  a line, would open read only under the replacement until reseeded, so it needs its own
  schema bump and decision), `@lexical/y/offline` (D13 stays deferred until jot chooses
  to keep notes on the device) and the new setup API (the existing one keeps working).

## Why

- Layout 4 is the only layout the pinned `@lexical/y` writes; staying on layout 3 means
  staying on the earlier build and its fixes.
- jot notes hold no NodeState on text, so `3to4` changes no content: it records layout 4
  and an epoch (2 items written, none deleted, on the richest fixture). The cost is the
  generation change every migration makes, which the fence already handles.

## Consequences

- After the deploy, every note migrates on its next open. A tab of the earlier release open
  on a note at that moment is closed and, on its reload, gets this release: its edits made
  offline against the old generation are handed off and wait under Offline edits (D34);
  replay at the note still waits for meta/lexical#9771.
- Not reversible by a rollback: the earlier release's pages are refused a note migrated to
  layout 4, so a fix goes forward.
- Notes already at layout 1 or 2 run the whole chain in one migration.
