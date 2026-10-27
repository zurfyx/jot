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
`/api/` (D17). The landing page carries neither and stays indexable. On a Preview,
Cloudflare marks every response `noindex` (D24).

## NoteRoom (`src/worker/room.ts`)

A SQLite-backed Durable Object per note (`new_sqlite_classes`), addressed by
`idFromName(noteId)`. It is a Yjs 14 relay written with `@y/y`, the same library as the
clients (D03).

- **Memory.** The constructor loads the stored state into a fresh gc-on `Y.Doc` with Yjs's
  format cleanup off (`cleanupFormatting = false`), as `@lexical/y` requires of a server that
  stores state: otherwise the room would delete format items the clients keep and send the
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

**Routes** (`router.ts`, History API only): `/` the landing page, `/new` a redirect to a
fresh note, `/new?example` a new example note, `/n/<id>` a note, `/docs` and `/docs/<slug>`
the docs. The Worker serves the SPA for `/n/<id>`; `/new` and `/docs` fall back to it as
assets. `notes.ts` and `examples.ts` (no Lexical
or Yjs, so the landing page can import them) hold the page side of starting notes (D23) and
examples. `newNotePath()` picks a fresh id in the browser and returns `/n/<id>`; every start
action navigates there, and `/new` replaces itself with it. `examples.ts` gives
`/new?example` a fresh id and marks it in sessionStorage (`jot:example:<id>`, `new` then
`played`), so only the tab that created an example runs its demo; when the example is
seeded, its editor stays mounted under the same React key while the address becomes
`/n/<id>`.

**Migration from local drafts** (D23). An earlier version kept an unshared draft in
`jot:draft` and, until the relay confirmed it, a shared note's copy in `jot:pending:<id>`
(localStorage, `{ id, state }` with the Yjs state in base64). `newNotePath()`, called when a
start commits to opening (`landing/open.ts` calls it after the editor chunk loads), copies a
leftover `jot:draft` to the new note's `jot:pending:<id>` under the Web Lock
`jot:legacy-draft`, re-reading the draft inside it, and removes the draft only once the copy
reads back; it never rejects, so storage or lock failures just open the note. `editor/legacy.ts`
runs when a note page opens: each `jot:pending:<id>` is pushed to its note by a headless
client, an empty `Y.Doc` and a `WebsocketProvider` with no presence. The server's sync step 2
(its whole state, against an empty state vector) and every later update are mirrored into a
gc-off document; once synced, `copyAddsTo` applies the copy to a scratch copy of the mirror.
No change means the server has it all, and the copy is removed; otherwise the copy is
written to the document, the provider sends it, and the check repeats on the echo. A note
status with the rejected flag removes the copy too (the note is full); after 30 s without
either, the copy stays for the next page.

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
  re-encoded from a gc-on document (`size.ts`), the way the room compacts it. The page's
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
    other than http, https and mailto unwrapped, inserted before the first target, then
    the targets removed).
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
freezes the page. The card (the clicked one, or the New note card for the button and the
keys), when it is on screen, carries `view-transition-name: jot-note` in the old state and
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

## Build and deploy

`@cloudflare/vite-plugin` builds the client and the Worker together (`dist/client`,
`dist/jot`); `wrangler` reads the built config. Cloudflare Workers Builds, connected to the
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
