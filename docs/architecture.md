# Architecture

```
browser                                   Cloudflare
┌──────────────────────────┐   wss      ┌──────────────┐   stub    ┌──────────────────────┐
│ React chrome             │ ─────────▶ │ Worker       │ ────────▶ │ NoteRoom (one per    │
│ Lexical + YCollabExt.    │ /api/n/    │ routes,      │ idFromName│ note): Yjs 14 relay, │
│ @y/websocket provider    │ <id>/ws    │ id checks,   │           │ SQLite row, alarm    │
│ Y.Doc (@y/y)             │            │ static assets│           │ (Hibernation API)    │
└──────────────────────────┘            └──────────────┘           └──────────────────────┘
```

## Worker (`src/worker/index.ts`)

One Worker with static assets (D01). `wrangler.jsonc` runs the Worker first for `/api/*`,
`/n/*` and `/new`; everything else is an asset. The landing page and the docs are
prerendered files (D31): `/` is `index.html` and `/docs/blame` is `docs/blame/index.html`,
`/docs/blame/` redirects to `/docs/blame` (`html_handling: "drop-trailing-slash"`), and a
path no file answers gets the prerendered `404.html` with a 404 (`not_found_handling:
"404-page"`), an unknown docs page included.

| Route                 | Behaviour                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /n/:id`          | Valid id: the note page's shell (`n/shell.html`). Otherwise 400.                                                                                                                  |
| `GET /new`            | The shell: the client picks the new note (and `?example`).                                                                                                                        |
| `GET /404`            | The 404 page, with a 404.                                                                                                                                                         |
| `GET /api/n/:id/ws`   | Valid id and a WebSocket upgrade: forwarded to the note's object.                                                                                                                 |
|                       | Invalid id: 400. No upgrade: 426.                                                                                                                                                 |
| `/api/n/:id/recovery` | The note's offline edits (D34): `POST` an upload, `GET` the list; `GET .../<seq>/view` (the record's source view, Yjs bytes) and `.../<seq>/raw`. Forwarded to the note's object. |
| `/api/*` otherwise    | 404                                                                                                                                                                               |
| anything else         | static assets; no file: `404.html`, 404                                                                                                                                           |

A valid id is 22 base64url characters encoding 128 bits, and nothing else: there are no
fixed ids (D02, D15). The Worker passes the id to the object in the `x-jot-note` header.

Every response the Worker gives for `/n/*` and `/api/*`, the WebSocket upgrade included,
carries `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows `/n/`, `/api/` and
`/new` (D17). The shell sits under `/n/`, so a request for it is a malformed note link.
The landing page and the docs carry neither and stay indexable; the 404 page says
`noindex`. On a Preview, Cloudflare marks every response `noindex` (D24). `robots.txt`
and `sitemap.xml` are static files (D32), so a Preview serves production's: harmless under
that header, and its sitemap only points crawlers at jot.rovira.sh.

## NoteRoom (`src/worker/room.ts`)

A SQLite-backed Durable Object per note (`new_sqlite_classes`), addressed by
`idFromName(noteId)`. It is a Yjs 14 relay written with `@y/y`, the same library as the
clients (D03).

- **Memory.** The constructor loads the stored state into a fresh `Y.Doc` from
  `createYDoc()` (`@lexical/y/headless`): gc on, with Yjs's format cleanup off, as
  `@lexical/y` requires of a server that stores state: otherwise the room would delete format items the clients keep and send the
  deletions out as its own edit. Sockets are
  accepted with the Hibernation API, so an idle note is evicted from memory while its
  sockets stay open; the next message runs the constructor again, which reloads the
  document. Each socket's awareness client ids and clocks ride in its attachment, so a
  departure can be announced after a wake.
- **Storage.** One row, `note(id = 0, name, state, saved_at)`. A save writes
  `encodeStateAsUpdate(doc)` two seconds after the first unsaved change, and at once when
  the last socket leaves. Because the document is gc-on, every save is also a compaction:
  deleted content never accumulates in storage (D05).
- **Cap.** 2,000,000 bytes of stored state (D05). Each update is checked against a cheap
  upper bound (`size + pending + update + 64`); only near the cap does the object measure
  `mergeUpdates([state, update])` exactly. An update that would pass the cap is not applied,
  and its sender gets a note-status message with the rejected flag.
- **Expiry.** Each connection sets the alarm to now + 90 days. When it fires with nobody
  connected, the object deletes all storage; with someone connected it reschedules (D06).
- **Generation fence** (D34). A `room` row holds the note's incarnation (128 random bits,
  made at the first visit that finds none, again after an expiry), whether it was
  inherited (the note had a stored row when the fence shipped), its seed contract and its
  generation, stored and never recomputed from the document per update. Every socket
  presents a handshake in its URL; `checkYSession` (`@lexical/y/server`, behind the
  adapter `library.ts`) decides, and the verdict and generation ride in the socket's
  attachment, so they survive hibernation. Only admitted sockets of the note's generation
  receive updates and awareness, and an update is applied only if its socket's generation
  is still the note's; anything else a fenced socket sends goes to a record. A socket
  without a handshake is admitted as before on an inherited, never-migrated note;
  elsewhere it is captured: the object sends sync step 1 with an empty state vector, keeps
  the client's step 2 as a standalone snapshot and every later update as a delta, then
  sends an update built on that snapshot that records `lexical-y-schema:<n + 1>` (the
  client's binding turns read only) and an empty step 2. The update is never applied to the
  note; a collision with the client's own ids is kept and signalled again.
- **Offline edits** (D34). `quarantine.ts`: `records` and `record_parts` (parts of at most
  1.9 MB, under the 2 MB row cap), and `bases` for the migrations to come. An upload is
  checked against the SHA-256 its header names, stored in one transaction, and answered
  with its acknowledgement (`shared/fence.ts`'s `UploadAcknowledgement`, `@lexical/y/server`'s
  `YRecordAcknowledgement` version 1: the note, the replica and its source generation, the
  record and its hash, plus the upload's SHA-256): the object holds a response until its
  writes are durable, so the answer is durable; the same upload twice is one record. `/view` serves a record's source view (its
  snapshot, deltas and queue in one scratch document) migrated on that copy through the
  bundled steps to the layout this build's pages read, as Yjs bytes, so a record an earlier
  jot made at layout 1 still shows: the object imports no Lexical, only `@lexical/y/server`,
  the runner and the steps. Records past 90 days are pruned;
  256 records or 64 MB per note answer further uploads with 507.
- **Migration on first open** (D34). Every request a note's object serves (a socket or a
  recovery request) first checks its served root against the floor (`steps.ts`:
  `LAYOUT_FLOOR`, the library's `MIN_LAYOUT`, with the frozen steps in chain order). Below
  it, before anything is served and with no `await` from the check to the commit (a
  Durable Object interleaves only at awaits): every socket closes with 4000; the live
  document is saved and its bytes migrate in place on a copy (`prepareYRoom`); one SQLite
  transaction stores the migrated state, the room's new generation, the old state as the
  immutable base of the old generation (`bases`), the transition (`transitions`, with the
  receipt) and, when the runner split pending material out, a `pending` record. The
  receipt is logged. A root nothing can read (no well-formed record or epoch) or a refused
  migration leaves the note `stuck`: no client is admitted to an unreadable root, and an
  update that still arrives is kept as a record, never applied. If the migrated state
  passes the 2 MB cap, the note becomes a fresh document under a new incarnation
  (`copy.ts`: every live item of every top-level type copied as it is into new items, with
  Yjs types only, so the history goes; ids, cursors and blame attribution are lost for that
  note; still over the cap, it is stuck). The Worker imports no Lexical: the layout
  constants come from `@lexical/y/server`.
- **No replay yet** (D34). A handoff is kept as a record and shown read only; nothing is
  replayed onto the note: the `@lexical/y` this release pins ships no replay (it comes
  with meta/lexical#9771). `/view` serves the record's source view (`sourceView`, a record
  this release reads) migrated on a scratch copy through the bundled steps to the layout
  this build's pages read (`migrateYState`), for rendering only.
- **Shadow receipts** (D34, off unless the `JOT_SHADOW_RECEIPTS` var is `"1"`): once per
  instance, a stored note under 1 MB is migrated on a copy to the layout the last bundled
  step reaches (`steps.ts`: `1to2` and `2to3`, layout 3) and the receipt is logged with a
  hash of the note id. Nothing is written.
- **Robustness.** Any malformed frame (text, unknown type, truncated varint, bad awareness
  JSON, undecodable update) closes that socket with 1007 and leaves the others alone.
  Clients reconnect with backoff and re-sync with the sync steps. No socket handler
  throws: a throw reaches Workers Logs as a bare exception with no message. Leaving
  (close, error or a malformed frame) runs each step on its own: the awareness removal,
  then the save if it was the last socket, then the close, with a code the server may
  send (1000 for the 1005, 1006 and 1015 the runtime reports). An unexpected failure is a
  `console.error` with the note id, the handler, the close code, the error and its stack.
  A failed save leaves the document unsaved, so the next change or departure tries again;
  a socket error is a `console.warn` and a 1011 close. If the upgrade fails after the
  socket is accepted, the socket is dropped and closed and the request gets a 500.

## Wire protocol (`src/shared/protocol.ts`)

The y-websocket protocol, as `@y/websocket@4.0.0-rc.2` speaks it, plus one message of
jot's own. Every frame starts with a varuint message type.

| Type | Name            | Direction | Body                                                                                                                                       |
| ---- | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | sync            | both      | y-protocols sync: step 1 (state vector), step 2, update                                                                                    |
| 1    | awareness       | both      | y-protocols awareness update                                                                                                               |
| 3    | query awareness | to server | none; the server answers with every known state                                                                                            |
| 64   | note status     | to client | varuint stored bytes, varuint flags (1 = update rejected)                                                                                  |
| 65   | note fence      | to client | varuint verdict (0 admit, 1 bootstrap, 2 stale, 3 refuse-layout), varstring generation, varuint may seed; only to sockets with a handshake |

A note's Y.Doc has two roots: `lexical-y`, the editor's content in `@lexical/y`'s layout,
and `jot-people` (`PEOPLE_ROOT`), the people registry blame reads (D19). The relay treats
both as opaque Yjs content. Every client binds with jot's schema version (`SCHEMA_VERSION`
in `src/shared/schema.ts`), which `@lexical/y` records on the `lexical-y` root with the
client's first write; a tab running an older jot opens a note a newer one wrote read only
(D29).

On connect the server sends sync step 1, the current awareness states and a note status.
The client answers step 1 and sends its own; the server's step 2 marks the client synced.
The server broadcasts every applied update to every socket, the sender included:
`@y/websocket` counts its own updates as confirmed when they come back. Awareness is
relayed without the y-protocols `Awareness` class, whose timer would keep the object from
hibernating; clients time out stale states themselves.

## Client (`src/client/`)

Vite, React and TypeScript. React draws the chrome; the editor is Lexical built with
`buildEditorFromExtensions` and mounted on a `contenteditable` element, so the app does not
depend on `@lexical/react` (which would pull in `@lexical/yjs` and Yjs 13).

**Routes** (`router.ts`, History API only): `/` the landing page, `/new` a redirect to a
fresh note, `/new?example` a new example note, `/n/<id>` a note, `/docs` and `/docs/<slug>`
the docs, anything else (an unknown docs page too) the 404 page (`NotFound.tsx`). A
malformed note link reached in the app goes home. `notes.ts` and `examples.ts` (no Lexical
or Yjs, so the landing page can import them) hold the page side of starting notes (D23) and
examples. `newNotePath()` picks a fresh id in the browser and returns `/n/<id>`; every start
action navigates there, and `/new` replaces itself with it. `examples.ts` gives
`/new?example` a fresh id and marks it in sessionStorage (`jot:example:<id>`, `new` then
`played`), so only the tab that created an example runs its demo; when the example is
seeded, its editor stays mounted under the same React key while the address becomes
`/n/<id>`.

**Recent notes** (D30). `recent.ts` (no Lexical or Yjs) keeps the notes this browser opened
in localStorage (`jot:recent`: `{ entries, removed, clearedAt }`, at most 20 entries of
`{ id, title, excerpt, openedAt, example? }`, newest first), prunes those not opened for 90
days on every read, and never throws. `createRecentStore` takes its storage, clock, Web
Locks, event target and `<html>` as arguments, so the unit tests pass fakes; the app uses
the window's. Every change runs inside the Web Lock `jot:recent` on a fresh read (at once
where locks are missing, or when asked to for `pagehide`); a removal leaves a tombstone and
Clear all a `clearedAt`, a visit stamped before either is dropped, and every write merges
with the stored state read just before it, keeping the newer of each. A title write takes
a getter and reads the note when it runs, inside the lock, so a write that waited writes
the latest text; across tabs the last write wins. Every change
notifies subscribers, other tabs arrive through the `storage` event, and `<html>` gets
`data-recent` with the rows the landing page shows (`--jot-recent-rows`,
`--jot-recent-rows-wide`), which the inline script in `index.html` also sets before the
first paint and every subscription brings up to date. `editor/useRecentVisit.ts` records a
visit when a note page opens and, once the note has synced, marks the title stale on every
content change; its recorder hands the store a getter for the first line and the start of
the rest, read only when a write runs (at most every 2 s), keeps a change pending until a
write that read it lands, and is flushed on `visibilitychange` to hidden and, without the
lock, on `pagehide`. On unmount it writes the last title at once and is disposed, so a
write still queued from it reads nothing and writes nothing. A subscriber that throws is
logged and skipped. The landing page's `RecentNotes` reads the list with
`useSyncExternalStore` (an empty server snapshot), hides its slot once hydrated if the list
is empty, refreshes its times every minute while visible, and opens a note through
`landing/open.ts` with its row as the card.

**Migration from local drafts** (D23, D34). An earlier version kept an unshared draft in
`jot:draft` and, until the relay confirmed it, a shared note's copy in `jot:pending:<id>`
(localStorage, `{ id, state }` with the Yjs state in base64). `newNotePath()`, called when a
start commits to opening (`landing/open.ts` calls it after the editor chunk loads), copies a
leftover `jot:draft` to the new note's `jot:pending:<id>` under the Web Lock
`jot:legacy-draft`, re-reading the draft inside it, and removes the draft only once the copy
reads back; it never rejects, so storage or lock failures just open the note. `editor/legacy.ts`
runs when a note page opens: each `jot:pending:<id>` has no generation the note can check, so
it is uploaded to its note's offline edits as a record of its own (`uploadMaterial`, the
handoff's upload), never merged into the note, and removed once the object acknowledges it
or refuses it for good; after four failed attempts it stays for the next page.

**The generation fence** (D34). `session.ts` keeps the generation the page's document
belongs to, adopted when a full sync with the note completes, and presents it in the
socket URL: the version 1 handshake `@lexical/y`'s layout upgrade handle builds
(`shared/fence.ts`: `f` its version, `g`, `m`, `lo`, `hi`, `seed`, and `ft` its features
when it has any; `@y/websocket` re-reads `provider.params` on every reconnect). This
release's `@lexical/y` reads layout 3 and up (MIN_LAYOUT 3) and its object migrates no note
(`layoutUpgrade: null`), so a note stored at layout 1 or 2 opens read only. The note's verdict (message 65) comes first: admit
and bootstrap sync as before; refuse-layout reloads the page once (a guard in
sessionStorage, `jot:fence-reload:<id>`), then shows "This note was upgraded. Reload to
keep editing."; stale runs the handoff (`editor/handoff.ts`): the provider stops,
`onBeforeHandoff` listeners stop the example's peers and jot AI, `binding.quiesce()`
commits what the editor holds and stops the binding writing, and the whole document (plus
a draft only for what could not be committed) is uploaded with its SHA-256 and retried with
the same bytes until the object acknowledges exactly that upload: the same note, replica,
source generation and SHA-256 (`acknowledges`); a bare hash acknowledges nothing. Then `onReplace` has `NotePage`
open a fresh session (its effect is keyed on the id and a generation key), which bootstraps
from the note. The uploaded hash is kept in sessionStorage (`jot:uploaded:<id>`).
`editor/recovery/` is the feature that shows records: a banner for this browser's own
(matched by `jot:clients` or an uploaded hash; Dismiss is remembered in
`jot:recovery-seen:<id>`) and ⋯ → Offline edits for every record that holds something the
note lacks; a record renders read only, with Copy text and Export (the raw bytes):
`recovery/render.ts`, a chunk only the recovery view loads, reads the record's source view
headless (`readYState`) with `jotNodesExtension` (`shared/nodes.ts`, jot's node set without
styles or DOM) and the higher of jot's schema version and the one the view records.

**`editor/session.ts`** creates a note session for an id: a `Y.Doc`, an `Awareness`, the
editor with `YCollabExtension`, a `WebsocketProvider`, and signals for connection, sync,
binding status, size, cap state, Work offline, edits waiting and "merged".

- **The provider** has no BroadcastChannel (the server is the one source of truth) and
  adopts the session's awareness. It connects in a task, so React Strict Mode's double
  mount opens one socket. `binding.initialize()` runs after the first sync; the binding's
  content-hashed seed keeps two clients opening an empty note at once from doubling it.
- **Confirmation.** A wrapped sync handler removes from `unconfirmedUpdates` what the server's
  sync step 1 already covers (content another client wrote first under the same derived
  client id never comes back as an echo); the provider removes what the relay echoes. The
  session is `confirmed` once synced and every update that was unconfirmed at the sync has
  been confirmed.
- **Work offline** calls `provider.disconnect()` and keeps the editor editable; the
  browser's `online` event no longer reconnects while it is on. Local transactions count
  as edits waiting from the first sync on, whenever the note is not confirmed. Those made
  while confirmed that the relay has not echoed yet count too once the connection drops: a
  link that dies silently is only noticed later (the provider's 30 s message timeout), and
  what was typed into it is waiting. When an offline spell (chosen or not) is confirmed,
  "merged" is true for four seconds and `onReconnect` listeners run, with whether the
  spell was Work offline.
- **Size and cap:** the size is the larger of the server's note-status figure and a local
  estimate (measured a second after changes, and on each sync): the page's state
  re-encoded from a relay document (`createYDoc`, `size.ts`), the way the room compacts it. The page's
  own encoding would count content the binding's undo stack keeps alive, so replacing a
  large passage a few times would look full long before the stored note is. It
  drives the pill, Note info and the cap state; a rejection makes the note read only at
  once.

**The chrome** (`editor/`):

- `NotePage.tsx`: top right `Avatars`, `StatusPill` and `ShareButton`; the note surface; the
  `Dock`; the ⌘K `CommandMenu`; ⌘⇧C copies the link.
- `Dock.tsx`: Aa (`FormatMenu.tsx`, block types and inline formats through Lexical
  commands and `$setBlocksType`; disabled, and closed, while the note is not editable, and
  every action checks editability first), ⋯ (`MoreMenu`) and `NoteInfo.tsx`. `menu.tsx` has the
  popover behaviour (Escape, outside press, arrow keys) and the menu item primitives.
- `features.ts`: the extension points for features. A `NoteFeature` can add a dock item
  before or after the others (`dockStart`, `dockEnd`), items at the top of ⋯ (`menuTop`),
  a ⋯ item after Note info that opens a panel in the menu's place (`menuPanel`), a banner
  above the text (`banner`) and a layer over the note surface (`surface`);
  `session.onReconnect` reports merges. Ask AI, blame and the example use them.
- `blame/` (D19), all in the browser:
  - `registry.ts`: the `jot-people` root. `trackLocalPerson` writes this tab's entry
    (person id, name, colour, kind, last seen) on its first local edit, an insert or a
    deletion, refreshes it at most every ten minutes, and remembers the tab's client id
    in `jot:clients`; its transactions carry the `jot-people` origin, which the session
    does not count as edits waiting. `readRegistry` parses entries as untrusted input,
    ignores a last-seen time from the future, and decides "you" by this browser's client
    ids.
  - `attribution.ts`: builds a `ContentMap` from the doc's insert set, one
    `createIdMapFromIdSet` per person, and renders `lexical-y` with
    `toDelta({ deep: true, renderer: createAttributionsRenderer(map) })`.
  - `lines.ts`: walks that delta into lines of runs `{ length, personId }` (shares, main
    author per line), and pairs them with Lexical's lines without guessing: unique texts
    anywhere, repeated texts only in order and in equal numbers. Unknown shapes mark a
    line unreadable; nothing throws.
  - `moves.ts`: layout 1 writes a moved line as a deletion and an insertion, so the delta
    is in Lexical's order and the mover is named. A note written by an earlier build in
    layout 2 can hold move records (`↷`); it opens read only, and when its delta holds them
    this walk of the stored items marks the lines a record's range covers (and a join's own
    line) unreadable, or every line if the walk and the delta disagree.
  - `lexical.ts`, `paint.ts`, `highlights.ts`: Lexical's lines (blocks with inline
    children, by DFS), their elements by `getElementByKey`, run offsets mapped to
    `StaticRange`s over text nodes in one sweep (a TreeWalker; a `<br>` counts as a line
    break), and one `Highlight` per person, `jot-blame-N`, styled by a constructed style
    sheet. A line whose text doesn't match its element is skipped.
  - `Blame.tsx`, `schedule.ts`: Show blame in ⋯, the chip and legend, and the surface
    layer: the margin bars and names, and the hover card (`caretPositionFromPoint`, checked
    against the character's box). It recomputes 150 ms after the last document update and
    at least once a second while updates keep coming, and relays out on resize, only while
    blame shows; with blame off only the registry check runs per transaction. After a Work
    offline spell is confirmed, it shows blame for four seconds (`state.ts` batches the
    switch, so turning blame on during that flash keeps what it shows).
- `peers/peer.ts` (D20): in-tab peers, collaborators that run inside the tab as real Yjs
  clients. `createInTabPeer(host, person)` makes a `Y.Doc` of its own (its own client id),
  copies the note into it, and keeps the two in sync through `update` events, each side
  applying the other's updates under an origin the other side skips, so nothing echoes. A
  headless Lexical editor (no root element) runs `YCollabExtension` on that doc
  (`synced: true`, no undo); `edit(fn)` runs a discrete update on it and publishes its
  selection as its caret, and writes nothing (returning false) unless the note takes edits:
  the host's `writable()`, or its `status` `active` and `cap` not `full`, and the peer's own
  binding active. Every peer gets a new client id, never a reused one (an id writing
  against a stale copy would mint duplicate items); blame groups a person's ids by person
  id. Like a person, it writes its registry entry (kind `demo` or `ai`, `askedBy` for AI)
  on its first change, an insert or a deletion, and refreshes it at most every ten
  minutes, so a peer that only shows its caret adds nothing to the note. Its own
  `Awareness` is relayed into the note's (`applyAwarenessUpdate`), which the provider sends like any
  state; when the note reconnects it announces itself two clocks on, past the removal the
  relay sent for the page's lost socket, and `dispose()` removes its presence everywhere
  while its writes stay. A live peer mirrors every change to the note, keystrokes
  included, into its own document and editor, so callers dispose idle ones. The example's
  demo collaborators and jot AI use it.
- `example/` (D20): `content.ts` writes the offsite plan and finds its parts again by text
  in any editor's state (never by node key); `script.ts` is the demo, about 20 s, every
  step skipped when its part was edited away, all at once under reduced motion, stopped by
  an `AbortSignal`, and `resetDemo` puts its parts back for Replay; `controller.ts` starts
  it on the creating tab while it holds the Web Lock `jot-example:<id>` (a duplicated tab
  copies the sessionStorage flag, so it waits, and takes over when the original closes),
  after the first sync and while the note takes edits, checked again when the queued join
  runs: Ana and jot AI join, Ana seeds the note if her own copy of it is empty, blame turns on, the
  address moves to `/n/<id>`, and the script plays (a reload of that tab brings them back
  idle). A note that turns read only or full stops the script, and Replay demo is disabled
  until it takes edits again. "You" type through the page's own
  editor at the end of the first agenda item; the caret follows only if it is there, or
  if the person has not edited yet and the page has focus. `Example.tsx` has the banner,
  ⋯ → Replay demo and the surface hook that stops everything when the page unmounts (a
  layout effect, so the collaborators' departure is sent before the page closes its
  socket).
- `ai/` (D21, D26), all in the browser:
  - `models.ts`: the three models (Chrome built-in, Small `Qwen2.5-0.5B-Instruct`, Larger
    `Qwen3-1.7B`, each WebLLM model in a `q4f16_1` and a `q4f32_1` build), and the pure
    choice: `isSmallDevice()` from UA-CH `mobile`, the user agent, touch, `deviceMemory`
    and the screen; `defaultModel()` (Chrome's when available, else WebLLM by device size
    when WebGPU has a hardware adapter, else Chrome's if downloadable, else none);
    `activeModel()` (the stored choice where it can run); `modelState()` for the setting;
    `unsupportedReason()`; the choice in `localStorage` (`jot:ai-model`).
  - `device.ts`: the probes: `navigator.gpu.requestAdapter()` once per page (`shader-f16`
    picks the f16 build; a fallback adapter counts as none) and the device hints.
  - `prompt-api.ts`: Chrome's Prompt API, typed locally (`LanguageModel.availability()`,
    `create({ expectedInputs, expectedOutputs, initialPrompts, monitor, signal })`,
    `measureInputUsage()` and `inputQuota` where offered, `prompt(text, { signal })`,
    `destroy()`), and `checkAvailability()`, which never throws.
  - `backend.ts`: `AiBackend`, what the controller needs of any model: its name, a
    download that needs consent (or none), a passage limit, `availability()` (local) and
    `open({ system, signal, onProgress, consented })`, which resolves to a session with
    `prompt()`, or rejects with a `ModelError` (`consent`, `too-long`, `cut-off`, `load`).
    `promptApiBackend()` wraps Chrome's model.
  - `webllm/`: `worker.ts`, a module worker and the only importer of `@mlc-ai/web-llm`,
    runs one `MLCEngine` and answers `protocol.ts` messages (`load` with progress and its
    stage read from WebLLM's report text, `chat` with Qwen3's thinking off, `interrupt`);
    an `offline` load makes `Cache.add()` and cross-origin `fetch()` refuse with
    `NeedsDownload`. `cache.ts` reads and clears WebLLM's Cache Storage from the page
    (`webllm/model`, `webllm/config`, `webllm/wasm`): `cacheState()` says `complete` only
    with the tensor manifest, every shard, the tokenizer, the config and the WebGPU
    library. `client.ts` starts the worker to load a model (`new Worker(new
URL('./worker.ts', import.meta.url))`, or, in dev builds, `window.__jotWebLLMWorker`
    for tests), keeps one per page, stops it when it has no model and nothing to do, when
    a download is cancelled (and clears that download's files) and after 5 idle minutes,
    and makes `webllmBackend()`: consent unless the build is complete, an offline load
    when it is, "Loading" for cached loads, a 5,544-character passage limit from the
    4,096-token window, a reply budget of about twice the passage, a cut-off reply
    refused.
  - `choice.ts`: `aiModels()`, one per page: the probed device, the choice, what the
    cache holds of each build (`refreshCache()`), `remove()`, and `resolve()`, the backend
    Ask AI uses now or why none can run.
  - `markdown.ts`: the target (the top-level blocks between two points, tables refused),
    its Markdown (`$convertSelectionToMarkdownString` over whole blocks, text points only
    on text nodes, so blocks that start or end with a line break export too), its lossless
    snapshot (every node's JSON), the prompt, the reply cleaned of an unambiguous
    `markdown` fence, and `$replaceBlocks` (`$generateNodesFromMarkdownString`, links
    other than http, https and mailto unwrapped; when the reply has as many blocks as the
    target, each of the same kind and holding plain text alone, each old block takes its
    new text in place, its text nodes' text changed by `$applyTextDiff` from
    `textDiff.ts`; otherwise the new blocks are inserted before the first target, then
    the targets removed).
  - `textDiff.ts`: `diffWords` (a word-level diff into ordered hunks: the common start
    and end, then a longest common subsequence of words, whitespace runs and punctuation)
    and `$applyTextDiff`, which turns a text node into new text with one `spliceText` per
    hunk, right to left. The binding records a splice exactly, so the words a rewrite
    keeps keep their identity, their blame, and a peer's concurrent edits inside them, in
    place; a text set whole is recorded as before and after only, and the binding would
    diff it as one stretch from the first change to the last.
  - `controller.ts`: `aiState(session)`. Opening the field captures the page binding's
    `getCursor()` as the target and resolves the model. Ask resolves it again, checks the
    target in the page's editor, stops at the `consent` phase for a WebLLM model that isn't
    all here (until Download, whose consent names the model, build and size and must
    still match), opens the model under one `AbortController` (the `downloading`
    phase, with `loading` once WebLLM loads from its cache), then has jot AI join as an
    in-tab peer (kind `ai`, `askedBy`, one per asker) with its caret at the target; jot AI
    reads the target's Markdown and snapshot from its own editor, the prompt is checked
    against the model's limit and context window and sent, and, inside jot AI's editor, the
    same cursor is resolved again, the snapshot compared, the room in the note checked, and
    the target replaced. A request that settles after the field closed forgets its target
    (and its tint); a cancelled request never touches the state of a newer one. jot AI
    follows the peer rules: a fresh client id each time it joins, its registry entry with
    its first change (moving its caret writes nothing), and nothing written unless the note
    takes edits (the session's `writable()`); the asker gets an entry when jot AI writes
    (`writeLocalEntry`, which also records the client id as this browser's), so "asked by"
    names them. One request at a time; `cancel()` aborts it, or declines a download; jot AI
    leaves a minute after its last request, or with the page.
  - `AskAI.tsx`: the dock item and its panel (`dockStart`): the field, the download
    question, the progress meter, or why no model can run; and the surface hook that tints
    the target with a `Highlight`, makes Esc cancel a running request, and stops jot AI
    when the page unmounts.
  - `ModelPanel.tsx`: ⋯ → AI model (`menuPanel`): the three models as radio rows with
    their download, state and Delete.
- `RemoteCarets.tsx`: each client publishes `binding.getCursor()` (Yjs relative positions)
  in awareness with its name and colour; peers resolve them with `binding.$resolveCursor()`
  and draw carets and selections over the page. `people.tsx` lists the same states for the
  avatars and Note info.
- `extensions.ts`: rich text, lists and checklists, links, code blocks
  (`@lexical/code-core`, no highlighting), tables, tab indentation and markdown shortcuts.

**The landing page** and the note page are separate chunks: the editor, Lexical and Yjs load
only on a note page (`loadNote.ts`). The landing page prefetches that chunk when
a person points at or focuses a start action, or holds ⌘ or Ctrl. Its start actions open a
fresh `/n/<id>` (the example ones `/new?example`) through `landing/open.ts`: it loads the
editor chunk, then navigates inside `document.startViewTransition`, so a cold start never
freezes the page. The card (the clicked one, a recent note's row, or the New note card for
the button and the keys), when it is on screen, carries `view-transition-name: jot-note` in the old state and
`#root` carries it in the new one, both with a StyleX `viewTransitionClass` that styles the
pair (`<html>` gets one too, for the page's own `root` group): the group animates from
the card's box to the page's in 450ms; its `::view-transition-image-pair` is the sheet,
`--bg` clipped to corners that go from 20px to square (the page's picture is otherwise
transparent, and the clip keeps the card's shadow from scaling up);
`::view-transition-old(jot-note)` and `::view-transition-new(jot-note)` fill it (`width` and
`height` 100%, `object-fit: cover`, anchored top centre) and cross-fade with plain opacity
keyframes in the first 20%, in place of the browser's plus-lighter fade, which would add
them onto the sheet's colour. Under reduced motion no card is named and the pages cross-fade in 150ms; browsers
without the API switch pages directly.

**The docs** (`docs/`, D22) are a third chunk: a table of contents (`pages.ts`), one
component per page under `docs/content/`, and code blocks from real files imported with
`?raw` (`sources.ts`): snippets in `src/docs/snippets/`, which `pnpm typecheck` checks with
the app, and declarations cut out of jot's own source by `excerpt.ts`, linked to their
lines on GitHub. The live inspector (`Inspector.tsx`) is a lazy chunk of its own: a jot
editor on a local `Y.Doc` beside the `lexical-y` root as rows (`yjsTree.ts`), whose lines
pair in document order with the editor's line elements (`lines.ts`). Its editor adds a
theme of its own over jot's, so its blocks take the article's smaller sizes.

There is no Yjs 14 IndexedDB provider yet, so a note's offline edits live in memory
until the socket reconnects (D13).

**Prerendering** (D31). The landing page, every docs page and the 404 page are HTML at
build time; a note's page is not. `main.tsx` hydrates a root that has children
(`hydrateRoot`) and renders into an empty one. The prerender renders `App` at a path of its
choice (`setPrerenderPath`; `useLocationPath` reads it as its server snapshot, the browser
its own address), so the first render in the browser must be the same: what depends on
the browser runs in effects, animations render their opening frame and start after load,
the landing page's illustrations (the fan's example card, the two windows and their steps)
hold their moving frames and their still end frame side by side (`landing/MotionFrames.tsx`,
`display: contents` wrappers), and `globals.css` shows the still one under
`prefers-reduced-motion: reduce`, so reduced motion shows the end from the first paint,
the live inspector mounts after hydration (its loading frame is what the HTML has), and
the note page and the inspector are never in the prerender's bundle (`import.meta.env.SSR`).
What depends on the device is CSS: the landing page's and the docs' roots carry
`data-scope`, and `globals.css` gives them their dark token sets under `data-theme`; the
start shortcut renders both labels, and `index.html`'s pre-paint script marks Apple
platforms (`data-platform`) for CSS to show ⌘ rather than Ctrl. Start a new note and See
the example are links to `/new` and `/new?example`, so they work before hydration, each
`rel="nofollow"`, since following one creates a note. `<html>` gets `data-hydrated` once
the page's content has hydrated (`hydrated.ts`): each prerendered page marks it from inside
its own boundary (the landing page, the docs once their chunk has hydrated, the 404 page),
App marks a note's page; tests wait for it.

Every public page's head comes from one list, `heads.ts` (the landing page's head in
`site.ts`, one per docs page from `docs/pages.ts`): its title, description, canonical URL
on jot.rovira.sh, link-preview image (`public/og/`) and type. The prerender writes them as
`<title>`, the description, `<link rel=canonical>`, Open Graph and Twitter tags and JSON-LD
(`WebSite` on `/`, `TechArticle` on a docs page), from `headTags` (`head.ts`); when the app
moves to another page without a reload, `applyHead` puts the same tags in place: the
landing page's, a docs page's, the 404 page's (`noindex`, no canonical) or a note's (none of
them). The docs import it. The landing page, the 404 page and a note use `syncHead.ts`,
in the entry chunk: a note's head and the 404 page's need no data, so it drops a public
page's tags itself; the landing page's title it sets at once, and its other tags come from
`head.ts`, loaded only when they aren't already in place. Each page claims the head as it
shows (`claimHead`), so a `head.ts` that arrives after the app has moved on is dropped; if it
fails to load (offline), the title stays right and the next move home tries again. The 404 page is `noindex`.

## Build and deploy

`pnpm build` runs `vite build`, where `@cloudflare/vite-plugin` builds the client and the
Worker together (`dist/client`, `dist/jot`), then `scripts/prerender.ts` (D31): a server
build of `src/client/prerender.tsx` (Vite's SSR build, with the same StyleX plugin, so the
same class names) renders each public page with React's `prerender` into the built
`index.html`, with its head, the main Geist font preloaded, a docs page's chunk and
stylesheet linked (from the client build's manifest, which it then moves out of the served
files to `dist/client.manifest.json`) and a
`<noscript>` style that gives the dark token sets to a system in dark mode when no script
runs. It writes `index.html`, `docs/index.html`, `docs/<slug>/index.html` and `404.html`,
and keeps the built shell as `n/shell.html`, with a `<noscript>` notice (`NoScriptNotice`,
which shares the 404 page's styles) that jot needs JavaScript to edit notes. Any error
React reports while rendering, or a page without its heading, fails the build. Then it
writes what crawlers and assistants read (D32): `robots.txt` (the rules and the
sitemap's address), `sitemap.xml` from every page's canonical URL, a Markdown copy of each docs page converted from its prerendered `<article>` by
`scripts/markdown.ts` (`/docs.md`, `/docs/<slug>.md`, code fenced with its `<pre>`'s
`data-language`), `llms.txt` (jot's summary and every docs page by group, from
`docs/pages.ts`) and `llms-full.txt`. Every page it writes, and the shell, loads the app's
script at low priority (`fetchpriority="low"`, and on a docs page its `modulepreload`
links too), so the HTML, the stylesheet and the font arrive first (D33). Last it appends to
`_headers`, file by file (a pattern would also reach the 404 page served for a missing
path): each text file's type in UTF-8, and `Cache-Control: public, max-age=31536000,
immutable` for every content-hashed file in `assets/`; everything else keeps the assets'
default, revalidated on every use. The build fails past Cloudflare's 100 rules.
`wrangler` reads the built config. The
link-preview cards are not built: `pnpm og-images` (`scripts/og-images.ts`) draws them in
Chromium from `heads.ts` and they are committed, each PNG carrying the hash of its card
(`scripts/og.ts`). Cloudflare Workers Builds, connected to the
repository, deploys every push to `main` to jot.rovira.sh (`wrangler deploy`) and every
other branch as a Worker Preview at `<preview-name>-jot.rovira.workers.dev`
(`wrangler preview`), with its own Durable Object namespace, where Cloudflare marks every
response noindex (D10, D24). GitHub Actions runs CI only: the
required checks gate merges, and no Cloudflare credential lives in GitHub.

The WebLLM worker builds as an ES module worker (`worker.format: 'es'`) into one asset of
about 6 MB (2.1 MB compressed), `assets/webllm-worker-<hash>.js`, that only the worker
loads; `public/_headers` serves it with `Referrer-Policy: no-referrer`, so its requests to
Hugging Face carry no Referer (huggingface.co refuses `*.workers.dev` Previews that send
one). The models themselves are not
part of the build: WebLLM fetches them from Hugging Face and raw.githubusercontent.com into
the browser's Cache Storage (D26).
