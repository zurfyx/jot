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

- `editor/session.ts` creates a note session: a `Y.Doc`, a `WebsocketProvider` (no
  BroadcastChannel: the server is the one source of truth), the editor with
  `YCollabExtension`, and signals for connection, sync, binding status and cap state. It
  calls `binding.initialize()` after the first sync; the binding's content-hashed seed
  keeps two clients opening an empty note at once from doubling it.
- `editor/extensions.ts`: rich text, lists and checklists, links, tables, tab indentation
  and markdown shortcuts.
- `editor/RemoteCarets.tsx`: each client publishes `binding.getCursor()` (Yjs relative
  positions) in awareness with its name and colour; peers resolve them with
  `binding.$resolveCursor()` and draw carets and selections over the page.
- The cap state comes from the server's note-status messages and a local estimate
  (`encodeStateAsUpdate` length, measured a second after changes). A rejection makes the
  note read only at once.
- `router.ts` routes `/`, `/new` and `/n/<id>` with the History API. `/new` (also
  `/new?example`) starts a fresh note: it resolves to a new `/n/<id>`.
- The landing page and the note page are separate chunks: the editor, Lexical and Yjs load
  only on a note page (`loadNote.ts`). The landing page prefetches that chunk when a person
  points at or focuses a start action.
- The landing page opens a note inside `document.startViewTransition`: the clicked card
  carries `view-transition-name: jot-note` in the old state and `#root` carries it in the
  new one, so the card grows into the note page. Under reduced motion the pages cross-fade
  in 150ms; browsers without the API switch pages directly.

There is no Yjs 14 IndexedDB provider yet, so offline edits live in memory until the
socket reconnects (D13).

## Build and deploy

`@cloudflare/vite-plugin` builds the client and the Worker together (`dist/client`,
`dist/jot`); `wrangler deploy` reads the built config. CI deploys the green tip of `main`
(D10).
