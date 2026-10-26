# Product

jot is a full-page note that anyone with the link can edit at the same time. It lives at
**jot.rovira.sh** and exists to put Lexical's Yjs 14 collaboration binding, `@lexical/y`, in
front of people before its npm release: a public playground for the near-production
version of the engine.

## What a person can do

- **Start a note.** The landing page's "Start a new note", ⌘↵ (Ctrl+Enter off Mac), any key
  typed on the page outside a field, or the New note card opens `/new`: a draft that lives
  only in this browser until it is shared. A refresh keeps it; ⋯ → New note starts an empty
  one (D18).
- **See the example.** "See the example" and the example card open `/new?example`, which
  creates a real shared note at once, fills it with an offsite plan and moves to its link,
  `/n/<id>`. Two demo collaborators, "Ana (demo)" and "jot AI (demo)", edit it live for
  about 20 s: Ana adds a to-do and a table row, then jot AI turns the agenda sentence into a
  bulleted list while "you" type in it. Blame is on, so three authors show. They run in
  the visitor's own tab as real Yjs peers, so a second window on the link sees their edits
  and carets through the relay. A banner above the title says "Example note · Ana and jot
  AI are demos in your browser", with Copy link and Start blank (`/new`); ⋯ → Replay demo
  runs it again. Only the tab that created the example runs them; leaving the page stops
  them, and a reload brings them back idle. Examples expire like any note (D20).
- **Share it.** Share gives a draft its link, `/n/<id>`, puts its content on the server and
  copies the link. On a shared note it copies the link. The link is the whole access model.
- **Join one.** Paste a jot link or just its code into the landing page's quiet "Or paste a
  note link to join it." line. It says which note it opens, or that the text isn't a note
  link or code.
- **Write together.** Rich text with headings, bold, italic, underline, strikethrough,
  inline code, links, bulleted, numbered and todo lists, quotes, code blocks and tables.
  Markdown shortcuts while typing; **Aa** in the bottom dock for block types and formats;
  a ⌘K menu (New note, Copy link, Toggle theme, Insert table, Go home). Collaborators'
  carets show their name and colour, and their avatars sit top right.
- **See who wrote what.** ⋯ → Show blame underlines each person's text in their colour and
  puts a bar with their name beside each run of lines they wrote most of. A "Blame" chip
  in the dock opens the legend: each person's share in characters; a click on a name
  fades everyone else; Hide blame. Hovering text says who wrote it and when they were
  last active (for jot AI, who asked). Deleted text is not shown (D19).
- **See the note's state.** The status pill says "Synced · 238 KB" (the note's Yjs size),
  "Connecting…", "Offline · 3 edits waiting", "Syncing · 3 edits waiting", "Back online ·
  merged" or, for a draft, "Only on this device". ⋯ → Note info shows the size against the 2 MB cap, who is here, and
  until when the note is kept.
- **Work offline on purpose.** ⋯ → Work offline, or a click on the pill, disconnects the
  note and keeps it editable, so a merge can be tried: edit in two windows, then
  Reconnect; blame then shows for four seconds, so the merge is visible. Losing the network
  behaves the same way. Edits made offline stay in the page
  until it reconnects; closing a shared note's tab while offline loses them (D13).

## Promises

- **The link is the key.** Ids are 128 random bits; there are no accounts and no listing.
  Anyone with a link can read and edit that note (D02).
- **Notes expire.** A note is deleted 90 days after its last visit (D06).
- **Notes stay out of search engines.** Note pages and the API are marked `noindex,
nofollow` and disallowed in `robots.txt`; only the landing page is indexable (D18).
- **Notes are small.** A note holds up to 2 MB of Yjs state. At 1.6 MB the page says
  "This note is almost full"; when an edit no longer fits, the page goes read only and says
  "This note is full. Start a new note to keep writing." (D05).
- **Newer notes open read only.** A note written in a document layout this version of the
  binding can't write opens read only rather than being misread.

## Not in scope

Accounts, permissions, version history, comments, search, export, and keeping shared
notes on the device (only an unshared draft is kept there). jot is a playground, not a
place to keep things.
