# D18: An unshared note lives only in this browser

Status: `SUPERSEDED` by [D23](D23-new-notes-are-shared-at-once.md): a new note is shared from
its first moment, and `/new` redirects to a fresh `/n/<id>`. D23 also says how drafts and
pending copies this decision left in browsers reach the relay. The rest of this file is the
decision as it stood.

## Context

Every "Start a new note" used to create a room on the server at once, so a visitor who
typed one word and left still made a Durable Object and a stored row. A note is only worth
a link once someone wants to share it.

## Decision

- **`/new` is a local draft.** It has a `Y.Doc` and the bound editor but no provider. The
  binding initializes at once (`YCollabExtension` with `synced: true`): there is nothing to
  wait for.
- **Persistence:** the draft's `Y.encodeStateAsUpdate(doc)`, base64, with a random draft id,
  in `localStorage` under `jot:draft`. It is written 500 ms after the last change (a
  debounce) and when the page hides. Opening `/new` again restores it, so a refresh loses
  nothing. One draft per browser; ⋯ → New note replaces it with an empty one. The pill
  says "Only on this device".
- **Share** generates an id, moves the draft to `jot:pending:<id>`, frees `jot:draft` (only
  if it still holds this draft: another tab may have stored its own), connects a provider
  to `/api/n/<id>/ws` with the same document, replaces the address with `/n/<id>` (same
  editor, no new history entry) and copies the link. The empty room receives the draft's
  whole state in the sync handshake. There is always one stored copy: when there is no room
  for two (a large draft near the storage quota), the draft slot is freed first and put
  back if the copy still can't be written. Then nothing is shared: the draft stays as it
  was and Share says "Couldn't share · retry".
- **Writes merge.** Every save merges with what is stored under the same draft id
  (`Y.mergeUpdates`), so a page never overwrites newer edits another page saved: two tabs
  on one draft, or two pages on one unconfirmed note.
- **Until the relay confirms,** the pending copy keeps being saved, edits after Share
  included. When the provider has no unconfirmed update left (the relay echoes every update
  it applies, and the server's sync step 1 covers content another client already wrote
  under the same derived client id), the page checks the stored copy against its document.
  It is removed, and only if the stored string is unchanged, when applying it would change
  nothing, inserts and deletes alike: everything in it is then confirmed. If it holds more
  (another page saved later edits), the page applies it, sends it, and checks again once
  that is confirmed. A page closed before confirmation leaves the copy behind, and the next
  page that opens `/n/<id>` applies it before connecting and pushes it. ⋯ → New note during
  a Share frees the draft slot but keeps the pending copy.
- **No double seeding.** The draft's binding is already initialized, so it writes nothing
  on the first sync; a second window on the new link reads the server's content. If a
  second window joins before the content arrives, it seeds an empty paragraph under the
  binding's content-derived client id, the same items the draft wrote, so Yjs keeps one
  copy.

## Consequences

- No server state exists until Share. The 2 MB cap (D05) applies to drafts through the
  local estimate; a full draft can't be shared.
- A draft is per browser profile: two tabs on `/new` share one draft, and their saves merge.
- localStorage has no compare-and-swap: a write from another tab between a page's check
  and its removal is the one window left, a few lines of synchronous code wide.
- A pending copy whose link is never opened again stays in localStorage. Clearing site
  data deletes drafts and pending copies. Shared notes still keep offline edits in memory
  only (D13).
