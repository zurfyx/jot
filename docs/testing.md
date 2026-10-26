# Testing

Three layers, each run in CI as its own job (D10).

## Unit (`pnpm test`, project `unit`)

Vitest in Node, next to the code (`src/shared/*.test.ts`):

- note ids: 22 base64url characters, 128 bits, no repeats, strict validation (the last
  character must be one of A, Q, g, w), the public id;
- link and code parsing for the paste field, including hosts that only look like jot's;
- link normalisation for the selection toolbar (no `javascript:` links);
- cap logic: the warn and full thresholds and the update bound.

## Durable Object (`pnpm test`, project `workers`)

`@cloudflare/vitest-plugin` (the successor of `@cloudflare/vitest-pool-workers`) runs the
real Worker and `NoteRoom` inside workerd with SQLite storage (D11). A small Yjs 14 client
(`src/worker/test-client.ts`) speaks the same protocol as `@y/websocket`.

- two WebSocket clients converge, and a late joiner gets the merged document;
- awareness is relayed and a departure is announced;
- an update that would pass 2 MB is rejected, its sender told, and others never see it;
- state survives eviction with hibernated sockets, and a reload from storage;
- the last client leaving saves at once;
- the expiry alarm is 90 days out and deletes storage when it fires; the public note has
  no alarm;
- malformed frames close only their socket;
- deleted content is compacted out of the stored row;
- malformed ids get 400 on both routes.

## End to end (`pnpm e2e`)

Playwright (Chromium) against its own dev server on port 5174: the real client, Worker and
Durable Objects, over real WebSockets.

- Start a new note goes to `/n/<id>` and shows the empty-note placeholder;
- the paste field validates in place and opens links and bare codes; the public note link;
- a malformed note link is a 400;
- the status pill reaches "Synced" and counts people;
- two pages on one note type and converge, the title follows the first line, and the
  other page shows a remote caret;
- a reload keeps the note;
- Share copies the link;
- markdown shortcuts, the selection toolbar's Bold and Link;
- the ⌘K menu toggles the theme;
- offline edits sync on reconnect (the test cuts one page's socket);
- a note in a newer layout opens read only with its banner.

Traces are kept on failure and uploaded by CI. In sandboxed macOS shells that can't run
Chromium's multi-process mode, set `JOT_E2E_SINGLE_PROCESS=1`.

## By hand

After UI changes, open the landing page and a note in light and dark at 1440px and 390px,
and type into one note from two windows.
