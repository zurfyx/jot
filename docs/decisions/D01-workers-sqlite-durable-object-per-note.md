# D01: Workers + one SQLite Durable Object per note, Hibernation API

Status: `DECIDED`

## Context

jot needs a WebSocket relay per note, durable storage for each note, and static hosting,
with no servers to run and a near-zero cost while notes sit idle.

## Decision

- One Cloudflare Worker with static assets serves the client and routes requests.
- Each note is one Durable Object (`NoteRoom`), addressed by `idFromName(noteId)`, with the
  SQLite storage backend (`new_sqlite_classes` migration).
- Sockets use the **WebSocket Hibernation API** (`ctx.acceptWebSocket`): an idle note is
  evicted from memory while its sockets stay open, and wakes on the next message.
- The object holds the Yjs document in memory and reloads it from SQLite on wake.
- Malformed input closes the offending socket (1007); nothing else is affected.
- `@cloudflare/vite-plugin` builds the client and the Worker together and runs both in
  workerd during `pnpm dev`.

## Consequences

- A note is a single-threaded actor: no locking, ordering is the object's.
- In-memory state is a cache. Anything that must survive eviction is in SQLite or in a
  socket attachment.
- The relay may not use timers that outlive a request (they block hibernation), which is
  why awareness is relayed without the y-protocols `Awareness` class.
