# D38: Every block stores an id (`BlockIdExtension`)

Status: `PROPOSED`

## Context

`@lexical/y/offline` (D37) matches a capture's blocks against the note by block id. Without
ids it matches by position and nothing is replayable, and the library's leftovers (blocks
that cannot be replayed, placed after the block they conflict with) have nowhere to go. jot
stored no block ids.

`BlockIdExtension` (`@lexical/extension`) stores each block's id as NodeState
(`blockId`). Under `@lexical/y`, a block stored without an id shows an id derived from its
Yjs identity (`y<client>_<clock>`, with a suffix for lists), the same on every client and
every reader, and the binding writes nothing for it; the block's next local edit stores the
id it shows. New blocks get random 21-character ids; two clients seeding the same initial
content give it the same ids.

## Decision

- `jotNodesExtension` (`src/shared/nodes.ts`) includes `BlockIdExtension` with
  `repairTransforms: false`, so every writer (the page, the example's and jot AI's in-tab
  peers) and every reader (recovery, the offline reports) has it, with the default
  `$isIdentifiedBlock` (the root's children, nested blocks that hold text).
- Existing notes are not rewritten. Their blocks show derived ids from the first open after
  the deploy, and store them as people edit them. Nothing is written by opening a note, so
  two tabs opening it at once cannot race: they show the same ids, and two tabs editing one
  block at once store the same value.
- jot's schema version stays 1 (D29): a tab of the release before keeps the ids it finds
  when it edits a block. Mixed configurations are supported by the library; such a tab
  stores no id on a block it creates (the others show a derived one) and copies an id when
  it duplicates a block (the others show a derived id on the copy). Neither loses content.
- Replay and leftovers stay off (D37's stage `persist`) until the library's leftovers ship;
  they turn on together.

## Why

- Ids are what replay and leftovers need; without them D37 can only list.
- Derived ids need no migration and no write on open: the safest way to give the notes that
  exist ids, and the reason the library derives them.
- Raising the schema version would turn every open tab of the release before read only for
  no data it could lose.

## Consequences

- A new block costs about 46 bytes more (the id on its marker, `s:blockId`): measured 6,961
  to 16,145 bytes for 200 short paragraphs, 19,992 to 29,191 for 200 lines of 80
  characters. A block written before stores its derived id on its next edit, at a similar
  cost. Under the 2 MB cap (D05) a note holds about 30% fewer blocks of 80-character
  lines, and more than half fewer of very short ones (a line of a few words). Typical notes
  are far below the cap; the pill and Note info already show the size.
- A derived id changes when the block's identity does (a list's comes from its first item,
  so an item added before it changes it), and a fresh copy (D34's fallback over the cap)
  changes every derived id: a capture made before such a change finds nothing to replay
  there and is listed, as today.
- The inspector shows `s:blockId` on every marker.
