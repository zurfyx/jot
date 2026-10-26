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

One Worker with static assets (D01). `wrangler.jsonc` runs the Worker first for `/api/*` and
`/n/*`; everything else is an asset, with unknown paths falling back to `index.html`.

| Route               | Behaviour                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `GET /n/:id`        | Valid id: the SPA (`index.html`). Otherwise 400.                  |
| `GET /api/n/:id/ws` | Valid id and a WebSocket upgrade: forwarded to the note's object. |
|                     | Invalid id: 400. No upgrade: 426.                                 |
| `/api/*` otherwise  | 404                                                               |
| anything else       | static assets                                                     |

A valid id is 22 base64url characters encoding 128 bits, and nothing else: there are no
fixed ids (D02, D15). The Worker passes the id to the object in the `x-jot-note` header.

Every response the Worker gives for `/n/*` and `/api/*`, the WebSocket upgrade included,
carries `X-Robots-Tag: noindex, nofollow`, and `public/robots.txt` disallows `/n/` and
`/api/` (D17). The landing page carries neither and stays indexable.

## NoteRoom (`src/worker/room.ts`)

A SQLite-backed Durable Object per note (`new_sqlite_classes`), addressed by
`idFromName(noteId)`. It is a Yjs 14 relay written with `@y/y`, the same library as the
clients (D03).

- **Memory.** The constructor loads the stored state into a fresh gc-on `Y.Doc`. Sockets are
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
- **Robustness.** Any malformed frame (text, unknown type, truncated varint, bad awareness
  JSON, undecodable update) closes that socket with 1007 and leaves the others alone.
  Clients reconnect with backoff and re-sync with the sync steps.

## Wire protocol (`src/shared/protocol.ts`)

The y-websocket protocol, as `@y/websocket@4.0.0-rc.2` speaks it, plus one message of
jot's own. Every frame starts with a varuint message type.

| Type | Name            | Direction | Body                                                      |
| ---- | --------------- | --------- | --------------------------------------------------------- |
| 0    | sync            | both      | y-protocols sync: step 1 (state vector), step 2, update   |
| 1    | awareness       | both      | y-protocols awareness update                              |
| 3    | query awareness | to server | none; the server answers with every known state           |
| 64   | note status     | to client | varuint stored bytes, varuint flags (1 = update rejected) |

A note's Y.Doc has two roots: `lexical-y`, the editor's content in `@lexical/y`'s layout,
and `jot-people` (`PEOPLE_ROOT`), the people registry blame reads (D19). The relay treats
both as opaque Yjs content.

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

**Routes** (`router.ts`, History API only): `/` the landing page, `/new` the local draft,
`/new?example` a new example note, `/n/<id>` a note. The Worker serves the SPA for
`/n/<id>`; `/new` falls back to it as an asset. `drafts.ts` and `examples.ts` (no Lexical or
Yjs, so the landing page can import them) hold the page side of drafts and examples: when a
draft is shared, or an example is seeded, its editor stays mounted under the same React key
while the address becomes `/n/<id>`. `examples.ts` gives `/new?example` a fresh id and marks
it in sessionStorage (`jot:example:<id>`, `new` then `played`), so only the tab that created
an example runs its demo.

**`editor/session.ts`** creates a note session: a `Y.Doc`, an `Awareness`, the editor with
`YCollabExtension`, and signals for connection, sync, binding status, size, cap state,
Work offline, edits waiting and "merged".

- **A shared note** gets a `WebsocketProvider` (no BroadcastChannel: the server is the one
  source of truth) that adopts the session's awareness. `binding.initialize()` runs after
  the first sync; the binding's content-hashed seed keeps two clients opening an empty note
  at once from doubling it.
- **A draft** (D18) has no provider. Its stored state (`jot:draft` in localStorage, with a
  draft id) is applied before the binding starts, and the binding initializes at once
  (`synced: true`). Changes are written back 500 ms after the last one (a debounce) and on
  `pagehide`. `share()` moves the draft to `jot:pending:<id>`, frees `jot:draft` if it still
  holds this draft, and connects a provider with the same document; the draft's content is
  pushed onto the provider's `unconfirmedUpdates`. If the copy can't be stored, `share()`
  returns null and nothing changes. Saves merge with the stored copy of the same draft. Once
  nothing is unconfirmed, the pending copy is removed only if it adds nothing to the
  document (checked on a scratch copy); a newer one is applied and sent first. A shared
  note that finds a pending copy for its id applies it before connecting and confirms it
  the same way.
- **Confirmation.** A wrapped sync handler removes from `unconfirmedUpdates` what the server's
  sync step 1 already covers (content another client wrote first under the same derived
  client id never comes back as an echo); the provider removes what the relay echoes. The
  session is `confirmed` once synced and every update that was unconfirmed at the sync has
  been confirmed.
- **Work offline** calls `provider.disconnect()` and keeps the editor editable; the
  browser's `online` event no longer reconnects while it is on. Local transactions count
  as edits waiting whenever a shared note is not confirmed (a shared draft that never
  connected included), until it is. When an offline spell (chosen or not) is confirmed,
  "merged" is true for four seconds and `onReconnect` listeners run, with whether the
  spell was Work offline.
- **Size and cap:** the size is the larger of the server's note-status figure and a local
  `encodeStateAsUpdate` length (measured a second after changes, and on each sync). It
  drives the pill, Note info and the cap state; a rejection makes the note read only at
  once.

**The chrome** (`editor/`):

- `NotePage.tsx`: top right `Avatars`, `StatusPill` and `ShareButton`; the note surface; the
  `Dock`; the ⌘K `CommandMenu`; ⌘⇧C copies the link (sharing a draft first).
- `Dock.tsx`: Aa (`FormatMenu.tsx`, block types and inline formats through Lexical
  commands and `$setBlocksType`; disabled, and closed, while the note is not editable, and
  every action checks editability first), ⋯ (`MoreMenu`) and `NoteInfo.tsx`. `menu.tsx` has the
  popover behaviour (Escape, outside press, arrow keys) and the menu item primitives.
- `features.ts`: the extension points for features. A `NoteFeature` can add a dock item
  before or after the others (`dockStart`, `dockEnd`), items at the top of ⋯ (`menuTop`),
  a banner above the text (`banner`) and a layer over the note surface (`surface`);
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
  - `moves.ts`: when the delta holds layout 2 move records, walks the stored items to mark
    the lines a record's range covers (and a join's own line) unreadable, or every line if
    the walk and the delta disagree.
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
- `ai/` (D21), all in the browser:
  - `prompt-api.ts`: Chrome's Prompt API, typed locally (`LanguageModel.availability()`,
    `create({ expectedInputs, expectedOutputs, initialPrompts, monitor, signal })`,
    `measureInputUsage()` and `inputQuota` where offered, `prompt(text, { signal })`,
    `destroy()`), and `checkAvailability()`, which never throws.
  - `markdown.ts`: the target (the top-level blocks between two points, tables refused),
    its Markdown (`$convertSelectionToMarkdownString` over whole blocks, text points only
    on text nodes, so blocks that start or end with a line break export too), its lossless
    snapshot (every node's JSON), the prompt, the reply cleaned of an unambiguous
    `markdown` fence, and `$replaceBlocks` (`$generateNodesFromMarkdownString`, links
    other than http, https and mailto unwrapped, inserted before the first target, then
    the targets removed).
  - `controller.ts`: `aiState(session)`. Opening the field captures the page binding's
    `getCursor()` as the target. Ask checks the target in the page's editor, creates the
    model under one `AbortController`, then has jot AI join as an in-tab peer (kind `ai`,
    `askedBy`, one per asker) with its caret at the target; jot AI reads the target's
    Markdown and snapshot from its own editor, the prompt is measured against the context
    window and sent, and, inside jot AI's editor, the same cursor is resolved again, the
    snapshot compared, the room in the note checked, and the target replaced. A request
    that settles after the field closed forgets its target (and its tint); a cancelled
    request never touches the state of a newer one. jot AI follows the peer rules: a fresh client id each time
    it joins, its registry entry with its first change (moving its caret writes nothing),
    and nothing written unless the note takes edits (the session's `writable()`); the
    asker gets an entry when jot AI writes (`writeLocalEntry`, which also records the client
    id as this browser's), so "asked by" names them. One request at
    a time; `cancel()` aborts it; jot AI leaves a minute after its last request, or with
    the page.
  - `AskAI.tsx`: the dock item and its panel (`dockStart`), and the surface hook that tints
    the target with a `Highlight`, makes Esc cancel a running request, and stops jot AI
    when the page unmounts.
- `RemoteCarets.tsx`: each client publishes `binding.getCursor()` (Yjs relative positions)
  in awareness with its name and colour; peers resolve them with `binding.$resolveCursor()`
  and draw carets and selections over the page. `people.tsx` lists the same states for the
  avatars and Note info.
- `extensions.ts`: rich text, lists and checklists, links, code blocks
  (`@lexical/code-core`, no highlighting), tables, tab indentation and markdown shortcuts.

**The landing page** and the note page are separate chunks: the editor, Lexical and Yjs load
only on a note page or a draft (`loadNote.ts`). The landing page prefetches that chunk when
a person points at or focuses a start action, or holds ⌘ or Ctrl. Its start actions go to
`/new`: it loads the editor chunk, then navigates inside `document.startViewTransition`, so
a cold start never freezes the page. The clicked card carries
`view-transition-name: jot-note` in the old state and `#root` carries it in the new one, so
the card grows into the note's page (the example card opens `/new?example`). Under reduced motion the pages cross-fade in 150ms;
browsers without the API switch pages directly.

There is no Yjs 14 IndexedDB provider yet, so a shared note's offline edits live in memory
until the socket reconnects (D13).

## Build and deploy

`@cloudflare/vite-plugin` builds the client and the Worker together (`dist/client`,
`dist/jot`); `wrangler deploy` reads the built config. CI deploys the green tip of `main`
(D10).
