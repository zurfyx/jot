# Testing

Three layers, each run in CI as its own job (D10).

## Unit (`pnpm test`, project `unit`)

Vitest in Node, next to the code (`src/shared/*.test.ts`, `src/client/**/*.test.ts`,
`scripts/*.test.mjs`):

- the PR preview config (D10): a preview deploys only as `jot-pr-<number>`, with no routes
  and only its own Durable Object namespace; a production build, routes, a `script_name`,
  transferred, renamed or deleted classes, and any other binding or trigger are refused;
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
- confirmation: the server's state vector confirms inserts it covers, never deletes;
- blame: two peers' documents turn into lines of runs (a heading, bold text, a line break,
  a list, typing inside someone else's line), matching Lexical's lines; shares in
  characters; unregistered clients stay unattributed; two people with one colour are
  kept apart; nested blocks and inline nodes in hand-built deltas; malformed deltas never
  throw; line matching skips unknown lines, never pairs repeated text out of order, and
  finds unique moved ones;
- blame and moves: when Bea moves her line "same" above Ana's "same", neither is painted
  (never the wrong person); a line joined from a moved range ("onefour") is skipped while
  the others keep their authors; a walk that disagrees with the delta marks every line;
- painting: runs map onto text nodes and line breaks in one sweep, linear on long lines;
  the recompute debounce still runs at least once a second while updates keep coming;
- the people registry: entries parsed defensively, the newest entry names a person, a
  last-seen time from the future is ignored, "you" only for this browser's client ids
  (a stranger claiming your person id is someone else); a tab writes its entry on its
  first edit or deletion (not on remote updates) and refreshes it at most every ten
  minutes; blame's flash after a reconnect, a choice made during it keeps the snapshot
  and focus, and a restarted flash;
- in-tab peers (D20): a peer starts from the note and syncs both ways without echoing,
  writes under its own client id with its registry entry (kind and `askedBy`), relays its
  presence and caret (resolvable by the page's binding) into the note's awareness, comes
  back after the provider drops remote states on disconnect, stays visible to another
  client after the relay's removal of the page's states, writes nothing while the note is
  read only or full (or its host says no), writes its registry entry on its first change and refreshes it at most every ten
  minutes, gets a new client id every time it is re-created (only showing its caret writes
  nothing), removes its presence and its listener on dispose while its
  writes stay, and never throws from an edit;
- the example's controller: an empty note is seeded once, marked played, adopted and
  played; a note with content is never seeded; a played example brings the collaborators
  back idle under new client ids, writing nothing to the note; it waits for the first
  sync and a writable note, checked again when the queued join runs; the script stops
  when the note turns full or read only, and Replay then does nothing; a duplicated tab
  stays out while the original holds the lock and takes over, idle, when it closes; a
  Strict Mode remount still starts it; two creators that both saw an empty note make
  one plan;
- Ask AI (D21): the Prompt API is found only with both methods, availability is asked
  with the options `create` gets and never throws, download progress reads as a
  fraction; a heading, bold text and a list export as Markdown, and so do blocks that
  start or end with a line break and code blocks with blank first and last lines; a caret
  in a list targets the list (and the field says "the whole list") and a selection every
  block it touches, tables are refused; a reply replaces its blocks (an empty one changes
  nothing), code blocks round-trip, only http, https and mailto links survive, and only
  an unambiguous `markdown` fence is unwrapped (single and multiple code blocks keep
  theirs); the snapshot sees underline and alignment that Markdown drops. With a fake
  model on a real binding: nothing is sent before Ask; jot AI joins only once the model
  is ready, writes the reply under its own client id with its registry entry (kind `ai`,
  `askedBy`) and its caret, and is credited only with the characters it changed; on
  someone else's note, an asker who has typed nothing is recorded as this browser's own
  and named by `askedBy`; it writes into an empty block, shows the download, runs one
  request at a time, and a cancelled request never resets a newer one; it writes nothing
  (registry included) when cancelled, when the target changed meanwhile (underline
  included), when the note turned read only, has no room or the passage is over the
  context window; a request that settles after the field closed forgets its target; it
  refuses without a target, on a read-only note and with an empty reply, and leaves the
  note a while after writing or when the page closes, coming back under a new client id
  as the same person in blame;
- the example's script: Ana seeds the offsite plan; the demo (all at once) ends with Ana's
  to-do and row, jot AI's list and "your" words, three authors in blame; `resetDemo` puts
  the seed back and a replay reaches the same end; steps whose part was edited away are
  skipped; an abort stops it;
- the landing page's keys: ⌘↵ and Ctrl+Enter, which keys count as printable, fields, and
  space always left to scrolling, and the shortcut label per platform;
- the landing page's destinations resolve to the draft and the example, the two-windows
  phases and steps, and the feature tabs.
- the docs: routes, the page order and Previous and Next, and that every landing page link
  names a docs page; the highlighter keeps every character; excerpts cut whole
  declarations and fail on a missing one; the inspector's rows for headings, lists, bold,
  links, line breaks and tables, paired with Lexical's line elements; the binding's links
  name the pinned Lexical commit; and the chunk boundaries, from the source's static
  imports: the landing page reaches no docs or editor code, and the docs reach no Lexical
  or Yjs outside the lazy inspector;
- the docs' snippets do what the pages say: the merge converges, the headless seed is
  deterministic and reads back as Markdown, the registry maps clients to people whose runs
  jot's content map attributes, and the in-tab peer writes as its own client and follows the
  note without echoes.

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
  `/new?example` (which lands on `/n/<id>` with the example banner), as do "See the
  example" and the footer links; the feature tabs advance every 3 s, stop when one is
  chosen, and follow the arrow keys; the Blame tab's stage lays out as a narrow name
  column, a bar of at most 4px as tall as its row and flowing text (a paragraph on one or
  two lines, names never on the state pill or on each other) at 1440 and 390px; under
  reduced motion nothing animates and the final states show; and it loads without the
  editor chunk;
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
- the dock: Aa's block types (Heading 2, Todo list, Code), the ⋯ items (Show blame first),
  Escape, the Dark theme switch, and arrow keys in ⋯;
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
- blame, with two people in separate browser contexts: off, nothing is painted; on,
  `CSS.highlights` holds one highlight of `StaticRange`s per person over exactly the text each typed, the
  margin names both ("You" for oneself), the legend shows character shares, a name
  focuses that person, Hide blame clears it all; hovering text shows who wrote it; the
  registry on the server holds the writer's entry and none for a reader; reconnecting
  from Work offline shows blame for a few seconds;
- the example (D20): `/new?example` lands on `/n/<id>` with the offsite plan and its
  banner; both demo carets show in that tab and, through the relay, in a second browser
  where the banner does not show; the script plays to the same content in both; blame is
  on with three people (You, Ana (demo), jot AI (demo)), and the other window's blame
  shows three too; under reduced motion it plays at once and Replay demo plays it once
  more, not twice over; a reload brings the collaborators back idle under new client ids,
  without seeding or playing again; Start blank goes to `/new`, the page sends their
  removal itself before its socket closes, and the collaborators leave the note for the
  other window while the content stays; Copy link copies the note's link;
- Ask AI, with a fake `window.LanguageModel` from `addInitScript`: opening the field and
  choosing a suggestion sends nothing; the target is tinted; Ask sends the instruction and
  that block alone; jot AI's list appears with its caret, in a second browser too; blame
  names jot AI and You, its highlight covers the list, and its hover card says "asked by
  You"; without `LanguageModel` (and when it is unavailable) the panel only explains what
  it needs and nothing is created; Esc cancels a running request and nothing is written;
  on a draft, a downloadable model shows its download, then writes; on someone else's
  note, asking before typing shows "asked by You" in the asker's blame and "asked by
  <name>" in the writer's; the target tint goes when a request settles (cancelled or
  failed) after the field closed;
- the ⌘K menu toggles the theme;
- a note in a newer layout opens read only with its banner.
- the docs: every page renders with no em dashes; code blocks have their file name, a
  GitHub link and a working Copy; the nav, Previous and Next and in-page links move without
  a reload; an unknown page goes to `/docs`; the landing page links open them; on a phone,
  Pages opens the nav; the inspector shows the tree, follows typing and markdown
  shortcuts, pairs lines and rows on hover and with the caret (whichever moved last, so a
  pointer move after typing takes the lead back), and Tab leaves it.

Traces are kept on failure and uploaded by CI. In sandboxed macOS shells that can't run
Chromium's multi-process mode, set `JOT_E2E_SINGLE_PROCESS=1`. `JOT_E2E_PORT` moves the
test server off 5174, so two checkouts on one machine don't share a server.

## By hand

After UI changes, open the landing page and a note in light and dark at 1440px and 390px,
and type into one note from two windows.
