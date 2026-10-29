# D19: Blame from Yjs 14 attributions in the browser, with a people registry in the doc

Status: `DECIDED`

## Context

Blame (who wrote what) is the Yjs 14 feature jot exists to show. Every item in a Y.Doc
already carries the client id that inserted it, and Yjs 14 can render a type with
attributions (`ContentMap`, `AttributionsRenderer`). Two things are missing: a name for each
client id, and a way to draw it over Lexical's editor without changing its DOM. Yjs gives
every tab a new client id, so a client id alone is not a person.

## Decision

- **Everything runs in the browser.** The relay doesn't change: it stores and relays the
  registry like any other content.
- **A people registry in the note's Y.Doc,** a second root `jot-people` (`PEOPLE_ROOT` in
  `src/shared/protocol.ts`) beside `lexical-y`. One attribute per Yjs client id; its value
  is `{ p, n, c, k, a?, s }`: the person id, name, colour index, kind (`person`, `demo` or
  `ai`), for AI the person id of who asked, and the last-seen time in Unix seconds.
- **Identity.** Each browser keeps a stable person id (`jot:person` in localStorage) beside
  the name and colour presence already keeps, and the client ids its sessions registered
  (`jot:clients`, the last 100). The registry maps every client id to its person, and
  blame groups by person. "You" is decided by client id, never by the doc: an entry for
  one of this browser's client ids is always you, and one claiming your person id from
  any other client id is a separate person.
- **Writes.** A session writes its own entry on its first local edit (an insert or a
  deletion), and refreshes `s` at most every ten minutes while editing. A visit that only
  reads writes nothing, so reading a note never grows it. These writes are not counted as
  edits waiting.
- **Attributions.** `createInsertSetFromStructStore` (deleted items left out), split by
  client and grouped by person; per person, `createIdMapFromIdSet` with the attribute
  `createContentAttribute('insert', personId)`; then `createContentMap(inserts, deletes)`.
  The `lexical-y` root is rendered with `toDelta({ deep: true, renderer: createAttributionsRenderer(map) })` and
  walked into lines of runs `{ length, personId }`, following `@lexical/y`'s wire format
  (`¶` ends a line, `¦` ends a container's own inline content, `b:` nodes are blocks).
  Clients missing from the registry stay unattributed.
- **Deleted text is not shown.** jot garbage-collects deleted content to stay under 2 MB
  (D05); showing it would need gc off and history that grows fast.
- **Moves and joins: never guess.** `toDelta` renders storage order, but a move record
  (`↷`), which notes from before `@lexical/y` froze its layout can hold (D25), shows its
  range elsewhere, and a join shows pieces of other lines inside
  one. When the delta holds a record, a walk of the stored items finds every line a
  record's range covers (and the line a join shows in) and marks it unreadable; if that
  walk disagrees with the delta at all, every line is. Those lines are left unpainted.
- **Painting** never touches Lexical's DOM. Lexical's lines (a DFS over the editor state
  for blocks whose children are inline, then `editor.getElementByKey`) are paired with
  the readable blame lines: a text unique on both sides pairs wherever it is; a repeated
  text pairs only in order, when both sides hold it equally often and the lines line up.
  Anything else, and a line whose text doesn't match its element, is skipped. Underlines
  use the CSS Custom Highlight API, one `Highlight` of `StaticRange`s per person; the
  margin is an overlay beside the column.
- **Cost.** With blame off, the only work per transaction is the registry check (a few
  comparisons). With blame on, it recomputes 150 ms after the last document update, and
  at least once a second while updates keep coming; mapping runs to text nodes is one
  sweep per line.

## Consequences

- The registry counts towards the 2 MB cap: about 85 bytes per writing tab, and about 26
  bytes per refresh, which stay: the old value's content is garbage-collected, but its
  tombstone and the split it makes in the writer's run of items do not go away. At one
  refresh per ten minutes of editing, that is about 160 bytes per person per hour.
- There are no accounts, so impersonation can't be prevented. Names are whatever people
  chose in their browser, and anyone can write an entry with someone else's person id and
  a fresh `seen`, renaming them in blame until their next refresh (or for as long as the
  impostor keeps refreshing). Registry values are parsed as untrusted input; a `seen`
  more than five minutes in the future counts as never seen, so a forgery can't outrank
  honest entries for good, and nobody else's text can show as "You".
- Blame is missing, never wrong, where it can't be sure: in a note from before the layout
  froze (D25), the lines a move or join record covers go unpainted; anywhere, so does a
  line blame can't pair with Lexical's (repeated text out of order, or text that doesn't
  match its element). A line moved today is written again by its mover, who is credited.
- Text written before a client registered (or by older clients) shows no author.
- Colours are random per browser, so two people can pick the same one; blame gives the
  smaller share the next free colour, so its colours can differ from the avatars'.
- The example's demo collaborators (D20) and jot AI (D21) are in-tab peers that write
  entries of their own, of kind `demo` and `ai` (jot AI's with `askedBy`).
