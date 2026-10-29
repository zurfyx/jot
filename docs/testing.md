# Testing

Four layers. Unit, Durable Object and end-to-end tests each run in CI as their own job
(D10); the visual suite runs with the end-to-end tests, in the same Playwright image (D27),
split across three shards that the `e2e` check waits for. A fifth CI job, `zizmor`, audits
the workflows themselves.

## Unit (`pnpm test`, project `unit`)

Vitest in Node, next to the code (`src/shared/*.test.ts`, `src/client/**/*.test.ts`):

- note ids: 22 base64url characters, 128 bits, no repeats, strict validation (the last
  character must be one of A, Q, g, w; no fixed words such as `public`);
- link and code parsing for the paste field, including hosts that only look like jot's;
- link normalisation for Aa's link field (no `javascript:` links);
- cap logic: the warn and full thresholds and the update bound; the page's size estimate
  is what the relay would store, not the deleted content an undo stack keeps alive;
- size and copy formatting for the pill and Note info ("238 KB", "1.72 MB", "2 MB", edits
  waiting, the kept-until date);
- the migration from local drafts (D23): a leftover draft moves to the new note's pending
  copy under the Web Lock (none taken without a draft); of two tabs claiming at once only
  one gets it, and the draft is re-read inside the lock; with no room for the copy the
  draft stays; denied storage or a refused lock never throw, and `newNotePath` still gives
  a fresh note; a stored copy reads back as its Yjs update, and anything else (bad JSON, an
  empty state, bad base64, bytes that aren't an update) reads as nothing; only
  `jot:pending:` keys count as copies; a copy adds nothing to a server that holds it,
  deletions included (also when the server collected the deleted content), and adds to
  one missing an insert or a deletion;
- confirmation: the server's state vector confirms inserts it covers, never deletes;
- blame: two peers' documents turn into lines of runs (a heading, bold text, a line break,
  a list, typing inside someone else's line), matching Lexical's lines; shares in
  characters; unregistered clients stay unattributed; two people with one colour are
  kept apart; nested blocks and inline nodes in hand-built deltas; malformed deltas never
  throw; line matching skips unknown lines, never pairs repeated text out of order, and
  finds unique moved ones;
- blame and moves: a move is written again by its mover (layout 1, no `↷` records), so
  when Bea moves her line "same" above Ana's "same" the two are painted Bea then Ana, never
  swapped; a line joined from a moved one ("onefour") gets its main author, and the
  others keep theirs; a walk of layout 2 move records that disagrees with the delta marks
  every line;
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
  nothing), rewriting blocks of the same kind in place, code blocks round-trip, only http, https and mailto links survive, and only
  an unambiguous `markdown` fence is unwrapped (single and multiple code blocks keep
  theirs); the snapshot sees underline and alignment that Markdown drops. With a fake
  model on a real binding: nothing is sent before Ask; jot AI joins only once the model
  is ready, writes the reply under its own client id with its registry entry (kind `ai`,
  `askedBy`) and its caret, and is credited only with the words it changed (the old block keeps its text nodes, and takes the reply as one splice per changed run of words); on
  someone else's note, an asker who has typed nothing is recorded as this browser's own
  and named by `askedBy`; it writes into an empty block, shows the download, runs one
  request at a time, and a cancelled request never resets a newer one; it writes nothing
  (registry included) when cancelled, when the target changed meanwhile (underline
  included), when the note turned read only, has no room or the passage is over the
  context window; a request that settles after the field closed forgets its target; it
  refuses without a target, on a read-only note and with an empty reply, and leaves the
  note a while after writing or when the page closes, coming back under a new client id
  as the same person in blame;
- jot AI's splices: the word diff turns random pairs of texts into each other with
  ordered hunks apart, changes whole words and never splits a character; applied to a text
  node it reaches the target and keeps the node; under `@lexical/y` jot AI's client holds
  only the words it changed; and a rewrite racing a peer who types inside a word the
  rewrite keeps leaves the peer's text in that word, on both clients;
- Ask AI's models (D26): phones (UA-CH, the user agent, an iPad's touch), little memory
  and small screens count as small; the default is Chrome's model when available, else
  Small or Larger with WebGPU, else Chrome's download, else none, and a chosen model that
  can't run gives way to it; each WebLLM model picks its f16 or f32 build from the adapter,
  and its state reads Ready, Downloaded, Partly downloaded, Needs download or Not
  supported; the reasons for no model; the choice is kept and unknown values ignored; both
  builds of Small and Larger are still in WebLLM's prebuilt list at the URLs and context
  window jot uses. WebLLM's cache, over an in-memory Cache Storage: complete only with the
  manifest, every shard, the tokenizer, the config and the WebGPU library (each missing one
  makes it partial), another model's files don't count, and clearing removes a build's
  files and no one else's; the stage of each WebLLM progress text. The WebLLM backend,
  over a fake worker and cache: it starts no worker for a model that is missing or partial
  and asks for consent; a yes downloads with "Downloading" while fetching and "Loading"
  once loading; a complete model loads offline as "Loading" from its first report; a
  `NeedsDownload` from the offline load asks for consent; cancelling a download stops the
  worker and clears its files, and a retry started at once waits for that cleanup (so it
  never deletes the retry's download); cancelling a cached load keeps them; a reply
  interrupted on abort keeps the model; a cut-off reply is refused; the worker stops five idle minutes
  after its last use (fake timers) and at once after a failed load. The controller, with a
  downloadable backend: it asks before downloading and Not now downloads nothing,
  downloads after a yes with progress and then writes, asks again (and downloads nothing)
  when the model changed after the question, runs nothing on a yes for a download the
  model no longer needs, asks again for an evicted model without jot AI joining, forgets
  its target and asks nothing when the field closed during the cache check, drops a stale
  question when the field opens again, refuses a passage over the model's limit before
  anything is sent, writes nothing for a cut-off reply, an overlong prompt or a model that
  won't load, and Esc during the download writes nothing;
- the chunk boundaries also keep WebLLM out of every page: only its worker imports it;
- the example's script: Ana seeds the offsite plan; the demo (all at once) ends with Ana's
  to-do and row, jot AI's list and "your" words, three authors in blame; `resetDemo` puts
  the seed back and a replay reaches the same end; steps whose part was edited away are
  skipped; an abort stops it;
- a click on the blank page: below the text it aims at the end of the note (a note
  without blocks too), beside a line at the nearest point inside it, above the title
  into the first line, and the point stays inside even a box narrower than its insets;
- the landing page's keys: ⌘↵ and Ctrl+Enter, which keys count as printable, fields, and
  space always left to scrolling, and the shortcut label per platform;
- the landing page's destinations (`/new` and the example's route), the two-windows
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
- format items the clients keep (a bold around text another client deleted) are stored
  and relayed as they are: the room's document has Yjs's format cleanup off and sends no
  deletions of its own;
- malformed ids, `public` included, get 400 on both routes;
- note and API responses (400, 404, 426 and the 101 upgrade) carry
  `X-Robots-Tag: noindex, nofollow`.

## End to end (`pnpm e2e`)

Playwright (Chromium) against its own dev server on port 5174: the real client, Worker and
Durable Objects, over real WebSockets.

- the landing page: its title, headline, buttons, links and sections, with no em dashes;
  "Start a new note" (with its `aria-keyshortcuts`), ⌘↵ (Ctrl+Enter) and a printable key
  outside the paste field each open a note, while space only scrolls; hovering the New note
  card and the example card lifts them and shows Open, and clicking each opens a fresh
  `/n/<id>`, synced, or `/new?example` (which lands on `/n/<id>` with the example banner),
  as do "See the example" and the footer links; the feature tabs advance every 3 s, stop
  when one is chosen, and follow the arrow keys; the Blame tab's stage lays out as a narrow
  name column, a bar of at most 4px as tall as its row and flowing text (a paragraph on
  one or two lines, names never on the state pill or on each other) at 1440 and 390px;
  opening from the New note card, the example card and "Start a new note" runs a 450ms
  view transition (held paused to read it) whose group starts at the card's width and
  ends at the page's, with both pictures filling it (cover, never pinned top-left) and the
  cross-fade over by a quarter (card picture at 0, page at 1), and
  under reduced motion only a 150ms cross-fade with no card named; and the switch to the note page, inside the transition, takes under 750 ms (it waits for the note page's root, marked from its first render, with a 1.5 s limit); under reduced motion
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
- replacing a 450 KB passage five times leaves the note "Synced" at about one passage's
  size, not "Full";
- the page's height: an empty note doesn't scroll at 1440 and 390px, in light and dark,
  nor does an emptied example note with its banner; a note taller than the window does,
  and scrolled to the bottom its last line clears the dock; typing forty lines keeps the
  caret line above the dock after every line;
- a click on the blank page writes, at 1440 and 390px: below an empty note it focuses the
  editor without scrolling; below the text the typing lands at the end of the last line;
  in the margin beside a line, in that line, also with only `caretRangeFromPoint` (older
  Safari); below a note ending in a code block or a quote, on a new line after it; a tap
  below the text on a touch screen writes at the end; a press outside an open menu only closes it (the caret stays put), a click
  beside the dock writes, and a drag from the text onto the blank page keeps its selection;
- markdown shortcuts, and Aa's Bold and Link (no toolbar appears over a selection);
- the dock: Aa's block types (Heading 2, Todo list, Code), the ⋯ items (Show blame first),
  Escape, the Dark theme switch, and arrow keys in ⋯;
- Note info shows a size matching the pill, both people with "(you)" and "editing", and
  the 90-day line;
- Work offline in two windows (from ⋯ and from the pill): edits wait on both sides, both
  stay editable, Reconnect merges both and shows "Back online · merged", then "Synced";
  the browser's `online` event doesn't end Work offline;
- a dropped socket shows "Offline · N edits waiting" and syncs on reconnect;
- edits typed into a link that died silently (the page still connected, its content
  swallowed) count as waiting once the drop is noticed, and merge when the link is back;
- with the page's content held back (`page.routeWebSocket`), reconnecting stays "Syncing ·
  N edits waiting" until the server has the edits, then shows "Back online · merged";
- new notes (D23): "Start a new note" opens a synced `/n/<id>` that a second browser joins
  and that survives a reload; `/new` replaces itself with a fresh note each time; ⋯ → New
  note and ⌘K → New note open another empty one; a `jot:draft` left by the earlier version
  shows up in the next new note exactly once (its two lines, no extra empty one), reaches
  a second browser, and is cleared; with the editor chunk held back, a start claims
  nothing and the draft survives the page closing; with `localStorage` throwing, `/new` and
  "Start a new note" still open fresh notes; a `jot:pending:<id>` copy reaches its own note
  (not the new one) when a note page opens, and is cleared; a copy the server already
  holds, with a deletion, is cleared and changes nothing, and pushing one leaves the format
  items the note keeps around deleted text where they are; a copy for a full note is
  refused, cleared, and its note is not dialled again by the next page;
- Aa is disabled on a read-only note, and an open Aa menu closes when the note turns read
  only;
- blame, with two people in separate browser contexts: off, nothing is painted; on,
  `CSS.highlights` holds one highlight of `StaticRange`s per person over exactly the text each typed, the
  margin names both ("You" for oneself), the legend shows character shares, a name
  focuses that person, Hide blame clears it all; hovering text shows who wrote it; the
  registry on the server holds the writer's entry and none for a reader; reconnecting
  from Work offline shows blame for a few seconds; a table row written by Gerard, Ana and Gerard gets three margin bars, with no duplicate React keys;
- the example (D20): `/new?example` lands on `/n/<id>` with the offsite plan and its
  banner; both demo carets show in that tab and, through the relay, in a second browser
  where the banner does not show; the script plays to the same content in both; blame is
  on with three people (You, Ana (demo), jot AI (demo)), and the other window's blame
  shows three too; under reduced motion it plays at once and Replay demo plays it once
  more, not twice over; a reload brings the collaborators back idle under new client ids,
  without seeding or playing again; Start blank opens a fresh note, the page sends their
  removal itself before its socket closes, and the collaborators leave the note for the
  other window while the content stays; Copy link copies the note's link;
- Ask AI, with a fake `window.LanguageModel` from `addInitScript`: opening the field and
  choosing a suggestion sends nothing; the target is tinted; Ask sends the instruction and
  that block alone; jot AI's list appears with its caret, in a second browser too; blame
  names jot AI and You, its highlight covers the list, and its hover card says "asked by
  You"; without `LanguageModel` or WebGPU (and when the model is unavailable) the panel
  only explains why and nothing is created; Esc cancels a running request and nothing is written;
  on a new note, a downloadable model shows its download, then writes; on someone else's
  note, asking before typing shows "asked by You" in the asker's blame and "asked by
  <name>" in the writer's; the target tint goes when a request settles (cancelled or
  failed) after the field closed;
- Ask AI's models, with the device faked from `addInitScript` (Chrome's model or not,
  WebGPU or not, a phone by UA-CH) and a stub for the WebLLM worker
  (`window.__jotWebLLMWorker`) that reports WebLLM's stages and writes its files into the
  page's real Cache Storage: ⋯ → AI model lists the three with their downloads and states,
  the laptop default is Larger, a choice survives a reload, and looking starts no worker;
  on a phone, Ask with Small asks first with the mobile-data note and the focus on
  Download, and Not now and Esc download nothing; Download shows "Downloading", then
  "Loading", then jot AI writes the list, credited in blame and asked by You, and the
  setting shows Ready and its labelled Delete clears it; after a reload a downloaded model
  loads offline as "Loading", without asking; Esc during a download stops the worker and
  leaves no files; a switch to another model withdraws the question and asks again for
  the new size; a model missing its WebGPU library is Partly downloaded and asks first, a
  partial download can be deleted, and every file makes it Downloaded; Chrome's ready
  model is the default with no download; without WebGPU or built-in AI the panel explains
  why and every model reads Not supported; and the setting says "Downloading", then
  "Loading", then "Ready" while a download runs, as the field does;
- the ⌘K menu toggles the theme;
- scrollbars, in light and dark: the page, the ⋯ menu, the docs nav and its code blocks
  compute a transparent track, a thin width and the theme's thumb; the landing page's dark
  code block has the light thumb;
- a note in a newer layout opens read only with its banner.
- the keyboard and pointer paths between features: Aa from the keyboard (the first item
  takes the focus, arrows wrap past the last enabled item, Home goes back, Enter applies
  and gives the caret to the note); Aa → Link focuses its field and Esc returns to the
  note; Esc after ⋯ opened from the keyboard gives the focus to the note, while Esc after
  a pointer-opened Aa closes it and leaves the note, as Esc does anywhere in it; a second
  click closes a dock menu and opening one closes the other; Tab runs pill, Share, the
  note (where Tab indents, so Esc leaves it), then Aa, Ask AI, Blame (when on), ⋯, and
  Shift+Tab back; Note info and the AI model setting open from the keyboard,
  take the focus, and close with Esc (arrow keys move the model choice, which holds); Ask
  AI's field takes the focus, Tab reaches its suggestions, Esc returns to the note; ⌘K
  filters, moves with the arrows, closes with Esc, a click on the scrim or ⌘K again (the
  pointer picks the option under it); blame's legend from the keyboard; the status pill
  and its Reconnect from the keyboard; ⋯ → Work offline from the keyboard keeps the menu
  open; Share from the keyboard; the feature tabs' Home, End and wrapping arrows with one
  tab in the tab order; the landing page's tab order; the docs' Pages button on a phone;
- the docs: every page renders with no em dashes; code blocks have their file name, a
  GitHub link and a working Copy; the nav, Previous and Next and in-page links move without
  a reload; an unknown page goes to `/docs`; the landing page links open them; on a phone,
  Pages opens the nav; the inspector shows the tree, follows typing and markdown
  shortcuts, pairs lines and rows on hover and with the caret (whichever moved last, so a
  pointer move after typing takes the lead back), and Tab leaves it.

## Production build (`pnpm e2e`, project `production`)

A setup step builds the app; the tests then serve `dist/client` to the browser themselves
(`e2e/production/serve.ts`: no server, no Worker; a note's socket never connects). Their contexts come from the `newContext` fixture (`e2e/helpers.ts`), a browser of its own each under `JOT_E2E_SINGLE_PROCESS`. They
check the StyleX output (D28):

- every StyleX rule ships in exactly one stylesheet, the one the build chose for it, with no
  marker left; the note page's and the docs' own rules are in their chunks, and few rules
  are moved to the entry;
- only the listed global rules (color-scheme, the dark tokens, `<body>`, reduced motion,
  `::highlight()`, a table selection's `::selection`, the inspector's code) sit outside a
  layer, since unlayered CSS beats every component style;
- the entry stylesheet puts `reset` and every `stylex.p<priority>` layer in priority order
  before its first rule, and every layer any stylesheet uses is in that order;
- in dark and in light, the theme's background is on the page before the app's script runs
  (the script is held back);
- a lazy page's stylesheet that arrives 1.5 s late is in before the page's heading is;
- the docs page and a note page compute the same styles for every element whether opened
  directly or reached from the landing page or each other (their stylesheets load in a
  different order).

Plain unit tests (`scripts/vite-stylex.test.ts`) cover the plugin: a module imports its own
rules, layered by priority; the order declaration; a priority it can't order fails loudly;
where the build places rules (once, shared ones in the entry, a property's conditions kept
in one order); and `src/client/theme/tokens.test.ts` keeps the dark token list in step with
the light one.

## Visual (`pnpm e2e:docker`)

Screenshots of every screen and state, compared with `toHaveScreenshot` against the
baselines in `e2e/visual/baselines/<project>/` (D27). Four projects run every test: light
and dark, at 1440x900 and 390x844.

- the landing page, under reduced motion so its loops rest on their final states: the hero,
  the fan hovered and with each card lifted (three different pictures), the two windows at the end of their story,
  each feature tab, the developers section, the questions, the ending, the footer and the
  whole page;
- a note: empty; with every block and format (headings, the three lists with a checked
  to-do, a quote, a code block, a table, a link, bold, italic, underline, strikethrough and
  inline code); the dock, Aa, Aa's link field, ⋯, Note info, the AI model setting, ⌘K,
  Share after a copy (the page's timers held, so "Link copied" is still up at the capture),
  and focus rings from the keyboard;
- the status pill in each state, with the top bar: Synced, Connecting, Offline with edits
  waiting, Syncing, Back online, near the cap (amber, with its notice) and Full (red, with
  the full-note banner);
- two people: each one's view of the other's caret and selection; blame on, its legend, a
  focused author and the hover card; the example with its banner and both demo carets;
- Ask AI: the panel, the download question on a phone, the download's progress, the
  unavailable message, and jot AI's caret after it writes;
- every docs page, whole, the phone's page list, the inspector following a hovered row, and
  the inspector with a typed quote and code block (its own size at every width);
- a read-only note and a malformed link (and an unknown path going home).

`e2e/visual/motion.spec.ts` runs in the light 1440 project only. For the landing page's
load, the fan's lift, a dock menu, the status pill changing, Share confirming, blame's
legend and the view transition into a note, it records every animation and transition
started (target, property, duration, delay, easing, iterations, fill; no names) as a JSON
baseline, and screenshots frames with every animation paused at the same moment. Under
reduced motion the note page's triggers start nothing.

What would vary is fixed rather than masked (`e2e/visual/setup.ts`): the clock, each
person's name and colour, and the magnitude and order of Yjs client ids; shots load both
web fonts outright and wait for the status pill's size to settle (failing if it never
does), and a state a timer ends is captured with the page's timers held. A still shot
fails past a colour threshold of 0.1 or 40 differing pixels; a mid-motion frame past 0.3%
of its pixels. The screenshot projects never retry, in CI either: a shot that passes only
on a second try is a flaky baseline.

### Running it and updating baselines

The baselines are the Playwright image's pixels, so run the suite in that image:
`pnpm e2e:docker` runs `playwright test` inside the same image as CI (pinned in
`.github/workflows/ci.yml`; emulated x86-64 on Apple silicon), with its own
`node_modules` in a Docker volume. Arguments go to Playwright:

```bash
pnpm e2e:docker e2e/visual                      # the visual suite only
pnpm e2e:docker e2e/visual/note.spec.ts --project=visual-dark-390
pnpm e2e:docker e2e/visual --update-snapshots   # rewrite baselines on purpose
```

Update baselines only for an intended change to the look or motion, in the same PR as the
change, and look at every PNG and JSON that changed before committing. A failing run
leaves `<name>-actual.png`, `<name>-expected.png` and `<name>-diff.png` in `test-results/`
(CI uploads them as `playwright-traces-<shard>`, one per shard that failed). Outside the image, `pnpm e2e` leaves the visual
projects out (CI, or `JOT_E2E_VISUAL=1`, turns them on).

## Traces and ports

Traces are kept on failure and uploaded by CI. In sandboxed macOS shells that can't run
Chromium's multi-process mode, set `JOT_E2E_SINGLE_PROCESS=1`. `JOT_E2E_PORT` moves the
test server off 5174, so two checkouts on one machine don't share a server.

## By hand

After UI changes, run the visual suite, open the landing page and a note in light and dark
at 1440px and 390px, and type into one note from two windows.
