# Product

jot is a full-page note that anyone with the link can edit at the same time. It lives at
**jot.rovira.sh** and exists to put Lexical's Yjs 14 collaboration binding, `@lexical/y`, in
front of people before its npm release: a public playground for the near-production
version of the engine.

## What a person can do

- **Start a note.** The landing page's "Start a new note", ⌘↵ (Ctrl+Enter off Mac), any key
  typed on the page outside a field, the New note card or the footer's New note opens a new
  note at its own link, `/n/<id>`, connected and ready to share from the first keystroke.
  ⋯ → New note and ⌘K → New note do the same from a note. An old `/new` link opens a fresh
  note too (D23).
- **See the example.** "See the example" and the example card open `/new?example`, which
  creates a real shared note at once, fills it with an offsite plan and moves to its link,
  `/n/<id>`. Two demo collaborators, "Ana (demo)" and "jot AI (demo)", edit it live for
  about 20 s: Ana adds a to-do and a table row, then jot AI turns the agenda sentence into a
  bulleted list while "you" type in it. Blame is on, so three authors show. They run in
  the visitor's own tab as real Yjs peers, so a second window on the link sees their edits
  and carets through the relay. A banner above the title says "Example note · Ana and jot
  AI are demos in your browser", with Copy link and Start blank (a new note); ⋯ → Replay demo
  runs it again. Only the tab that created the example runs them (a duplicate of that tab
  waits, and takes over if the original closes); leaving the page stops them, and a reload
  brings them back idle. They stop writing as soon as the note is full or read only.
  Examples expire like any note (D20).
- **Share it.** Share (or ⌘⇧C, or ⋯ → Copy link) copies the note's link. The link is the
  whole access model.
- **Join one.** Paste a jot link or just its code into the landing page's quiet "Or paste a
  note link to join it." line. It says which note it opens, or that the text isn't a note
  link or code.
- **Write together.** Rich text with headings, bold, italic, underline, strikethrough,
  inline code, links, bulleted, numbered and todo lists, quotes, code blocks, tables and
  images.
  Markdown shortcuts while typing; **Aa** in the bottom dock for block types and formats;
  a ⌘K menu (New note, Copy link, Toggle theme, Insert table, Go home). Collaborators'
  carets show their name and colour, and their avatars sit top right.
- **Add images.** Paste a screenshot, drop an image file on the note, or choose Aa → Image.
  The browser shrinks it (1600 px on the long side, WebP) and uploads it; a placeholder
  shows its progress, then the image appears for everyone on the note. Others see
  "Someone is uploading an image…" meanwhile. A click selects an image, shows its alt text
  (the file name until someone writes one) for editing, and Backspace removes it. PNG,
  JPEG, WebP and GIF; a small GIF stays animated. Uploads need the network: while offline
  or in Work offline, Image is disabled and a paste says why. A refused file says why too
  ("a note holds at most 20 images") and leaves nothing behind. A note shows only its own
  images (D26).
- **See who wrote what.** ⋯ → Show blame underlines each person's text in their colour and
  puts a bar with their name beside each run of lines they wrote most of. A "Blame" chip
  in the dock opens the legend: each person's share in characters; a click on a name
  fades everyone else; Hide blame. Hovering text says who wrote it and when they were
  last active (for jot AI, who asked). Deleted text is not shown (D19).
- **Ask AI.** "✦ Ask AI…" in the dock opens a field for an instruction ("Make it a list",
  "Shorter", or anything). It applies to the selected blocks, or the block with the caret,
  tinted while the field is open; nothing is sent until the person presses Ask. Chrome's
  built-in model (Gemini Nano) does the work on the device, downloading once on the first
  Ask with its progress shown; elsewhere the field only says "Needs Chrome's built-in AI
  (Gemini Nano). Open jot in Chrome on desktop." The answer is written by **jot AI**, a
  collaborator of its own in violet with a named caret, so everyone on the note sees the
  edit arrive and blame credits jot AI with what it changed, asked by the person. One
  request at a time; Esc or Stop cancels it (D21).
- **See the note's state.** The status pill says "Synced · 238 KB" (the note's Yjs size),
  "Connecting…", "Offline · 3 edits waiting", "Syncing · 3 edits waiting" or "Back online ·
  merged". ⋯ → Note info shows the size against the 2 MB cap, who is here, and until when
  the note is kept.
- **Work offline on purpose.** ⋯ → Work offline, or a click on the pill, disconnects the
  note and keeps it editable, so a merge can be tried: edit in two windows, then
  Reconnect; blame then shows for four seconds, so the merge is visible. Losing the network
  behaves the same way. Edits made offline stay in the page
  until it reconnects; closing the tab while offline loses them (D13).
- **Read how it works.** `/docs` is a short guide for Lexical developers: a quick start,
  how a note is stored in Yjs (with a live inspector: type, and watch the Yjs tree change),
  presence, offline merging, blame, the AI peer, size limits, the relay and server-side
  editing. Every code block is a real, compiling file from the repo.

## Promises

- **The link is the key.** Ids are 128 random bits; there are no accounts and no listing.
  Anyone with a link can read and edit that note (D02).
- **Notes expire.** A note is deleted 90 days after its last visit (D06).
- **Notes stay out of search engines.** Note pages and the API are marked `noindex,
nofollow` and disallowed in `robots.txt`; only the landing page is indexable (D17).
- **Notes are small.** A note holds up to 2 MB of Yjs state. At 1.6 MB the page says
  "This note is almost full"; when an edit no longer fits, the page goes read only and says
  "This note is full. Start a new note to keep writing." (D05). Images are stored beside
  the note, not in it: at most 1.5 MB each after shrinking, 20 per note and 10 MB in all,
  deleted with the note. Removing an image from the text doesn't free its place (D26).
- **Newer notes open read only.** A note written in a document layout this version of the
  binding can't write opens read only rather than being misread.

## Not in scope

Accounts, permissions, version history, comments, search, export, private drafts, and
keeping notes on the device. jot is a playground, not a place to keep things.
