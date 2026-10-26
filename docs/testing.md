# Testing

Three layers, each run in CI as its own job (D10).

## Unit (`pnpm test`, project `unit`)

Vitest in Node, next to the code (`src/shared/*.test.ts`, `src/client/**/*.test.ts`):

- note ids: 22 base64url characters, 128 bits, no repeats, strict validation (the last
  character must be one of A, Q, g, w; no fixed words such as `public`);
- link and code parsing for the paste field, including hosts that only look like jot's;
- link normalisation for Aa's link field (no `javascript:` links);
- cap logic: the warn and full thresholds and the update bound;
- size and copy formatting for the pill and Note info ("238 KB", "1.72 MB", "2 MB", edits
  waiting, the kept-until date);
- drafts: a document round-trips through the stored string, large ones included; a
  corrupt draft is ignored; a page removes a stored draft only while it is still its own,
  and a copy only while it is exactly what it checked; a stored copy "adds" newer inserts
  and deletes and nothing when the document holds it; writes merge with the same draft,
  never another; a move keeps one copy when there is room for only one, and leaves the
  draft in place when the copy can't be stored; pending copies are kept per note;
- confirmation: the server's state vector confirms inserts it covers, never deletes.
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
- the status pill shows "Synced · <size>", and the avatars count the people here;
- two pages on one note type and converge, the title follows the first line, and the
  other page shows a remote caret;
- a reload keeps the note;
- Share copies the link, and so does ⌘⇧C;
- markdown shortcuts, and Aa's Bold and Link (no toolbar appears over a selection);
- the dock: Aa's block types (Heading 2, Todo list, Code), the ⋯ items, Escape, the Dark
  theme switch, and arrow keys in ⋯;
- Note info shows a size matching the pill, both people with "(you)" and "editing", and
  the 90-day line;
- Work offline in two windows (from ⋯ and from the pill): edits wait on both sides, both
  stay editable, Reconnect merges both and shows "Back online · merged", then "Synced";
  the browser's `online` event doesn't end Work offline;
- a dropped socket shows "Offline · N edits waiting" and syncs on reconnect;
- a draft at `/new` says "Only on this device", survives a reload, and ⋯ → New note
  empties it;
- Share turns a draft (with typos fixed, so with deleted content) into `/n/<id>`, copies
  the link, frees `jot:draft`, drops the pending copy once confirmed, and a second window
  sees identical content with one title and one list; an empty draft shared and joined at
  once seeds one paragraph;
- with a socket that never reaches the server (`page.routeWebSocket`), edits after Share
  are counted ("Syncing", then "Offline" under Work offline), survive leaving the page, and
  the next page on the link pushes them;
- with the page's content held back, a late confirmation keeps edits made after Share and
  leaves another tab's new draft alone; reconnecting stays "Syncing · N edits waiting"
  until the server has the edits, then shows "Back online · merged";
- ⋯ → New note during an unconfirmed Share keeps the shared content;
- a page that restored an older pending copy and gets it confirmed sends, rather than
  drops, the newer edits another page saved to it before leaving;
- when the pending copy can't be stored, Share shares nothing, says "Couldn't share ·
  retry", keeps the draft (still editable and saved), and works once there is room;
- Aa is disabled on a read-only note, and an open Aa menu closes when the note turns read
  only;
- the ⌘K menu toggles the theme;
- a note in a newer layout opens read only with its banner.

Traces are kept on failure and uploaded by CI. In sandboxed macOS shells that can't run
Chromium's multi-process mode, set `JOT_E2E_SINGLE_PROCESS=1`. `JOT_E2E_PORT` moves the
test server off 5174, so two checkouts on one machine don't share a server.

## By hand

After UI changes, open the landing page and a note in light and dark at 1440px and 390px,
and type into one note from two windows.
