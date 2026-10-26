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
  the name and colour presence already keeps. The registry maps every client id to its
  person, and blame groups by person.
- **Writes.** A session writes its own entry on its first local edit, and refreshes `s` at
  most once a minute while editing. A visit that only reads writes nothing, so reading a
  note never grows it. These writes are not counted as edits waiting.
- **Attributions.** `createInsertSetFromStructStore` (deleted items left out), split by
  client and grouped by person; per person, `createIdMapFromIdSet` with the attribute
  `createContentAttribute('insert', personId)`; then `createContentMap(inserts, deletes)`.
  The `lexical-y` root is rendered with `toDelta({ deep: true, renderer: createAttributionsRenderer(map) })` and
  walked into lines of runs `{ length, personId }`, following `@lexical/y`'s wire format
  (`¶` ends a line, `¦` ends a container's own inline content, `b:` nodes are blocks).
  Clients missing from the registry stay unattributed.
- **Deleted text is not shown.** jot garbage-collects deleted content to stay under 2 MB
  (D05); showing it would need gc off and history that grows fast.
- **Painting** never touches Lexical's DOM. Lines are matched in document order to
  Lexical's line elements (a DFS over the editor state for blocks whose children are
  inline, then `editor.getElementByKey`), with a fallback by text for blocks a peer moved.
  A line whose text doesn't match its element is skipped. Underlines use the CSS Custom
  Highlight API, one `Highlight` per person; the margin is an overlay beside the column.
- **Cost.** With blame off, the only work per transaction is the registry check (a few
  comparisons). With blame on, it recomputes 150 ms after the last document update.

## Consequences

- The registry counts towards the 2 MB cap: about 60 bytes per writing tab, plus a small
  overwrite a minute while someone edits (the old values are garbage-collected).
- Names are whatever people chose in their browser; anyone can claim any name, as with
  presence (D12). Registry values are parsed as untrusted input.
- Text written before a client registered (or by older clients) shows no author.
- Colours are random per browser, so two people can pick the same one; blame gives the
  smaller share the next free colour, so its colours can differ from the avatars'.
- PR "example" and PR "ai" write entries of kind `demo` and `ai` for their own peers.
