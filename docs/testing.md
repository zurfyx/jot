# Testing

Three layers, each run in CI as its own job (D10).

## Unit (`pnpm test`, project `unit`)

Vitest in Node, next to the code (`src/shared/*.test.ts`, `src/client/**/*.test.ts`):

- note ids: 22 base64url characters, 128 bits, no repeats, strict validation (the last
  character must be one of A, Q, g, w; no fixed words such as `public`);
- link and code parsing for the paste field, including hosts that only look like jot's;
- link normalisation for the selection toolbar (no `javascript:` links);
- cap logic: the warn and full thresholds and the update bound;
- the landing page's keys: ⌘↵ and Ctrl+Enter, which keys count as printable, fields, and
  space always left to scrolling, and the shortcut label per platform;
- the landing page's destinations resolve to `/new`, the two-windows phases and steps, and
  the feature tabs.

## Durable Object (`pnpm test`, project `workers`)

`@cloudflare/vitest-plugin` (the successor of `@cloudflare/vitest-pool-workers`) runs the
real Worker and `NoteRoom` inside workerd with SQLite storage (D11). A small Yjs 14 client
(`src/worker/test-client.ts`) speaks the same protocol as `@y/websocket`.

- two WebSocket clients converge, and a late joiner gets the merged document;
- awareness is relayed and a departure is announced;
- an update that would pass 2 MB is rejected, its sender told, and others never see it;
- state survives eviction with hibernated sockets, and a reload from storage;
- the last client leaving saves at once;
- the expiry alarm is 90 days out and deletes storage when it fires;
- malformed frames close only their socket;
- deleted content is compacted out of the stored row;
- malformed ids, `public` included, get 400 on both routes;
- note and API responses (400, 404, 426 and the 101 upgrade) carry
  `X-Robots-Tag: noindex, nofollow`.

## End to end (`pnpm e2e`)

Playwright (Chromium) against its own dev server on port 5174: the real client, Worker and
Durable Objects, over real WebSockets.

- the landing page: its title, headline, buttons, links and sections, with no em dashes;
  "Start a new note" (with its `aria-keyshortcuts`), ⌘↵ (Ctrl+Enter) and a printable key
  outside the paste field each open a note, while space only scrolls; hovering the New note
  card and the example card lifts them and shows Open, and clicking each opens `/new` or
  `/new?example`, as do "See the example" and the footer links; the feature tabs advance
  every 3 s, stop when one is chosen, and follow the arrow keys; under reduced motion
  nothing animates and the final states show; and it loads without the editor chunk;
- the paste field validates in place and opens links and bare codes;
- a malformed note link is a 400, `/n/public` included, and the landing page links no
  fixed note;
- a note page carries `X-Robots-Tag: noindex, nofollow`, the landing page does not, and
  `robots.txt` disallows `/n/` and `/api/`;
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
