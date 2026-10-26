# Product

jot is a full-page note that anyone with the link can edit at the same time. It lives at
**jot.rovira.sh** and exists to put Lexical's Yjs 14 collaboration binding, `@lexical/y`, in
front of people before its npm release: a public playground for the near-production
version of the engine.

## What a person can do

- **Start a note.** The landing page's "Start a new note", ⌘↵ (Ctrl+Enter off Mac), any key
  typed on the page outside a field, or the New note card opens `/new`, which starts a new,
  empty note at `/n/<id>`.
- **See the example.** "See the example" and the example card open `/new?example`. Until the
  example note exists, it starts an empty note like `/new`.
- **Share it.** The note's link is the whole access model. Share copies it.
- **Join one.** Paste a jot link or just its code into the landing page's quiet "Or paste a
  note link to join it." line. It says which note it opens, or that the text isn't a note
  link or code.
- **Write together.** Rich text with headings, bold, italic, inline code, links, bulleted,
  numbered and checklists, quotes and tables. Markdown shortcuts while typing, a selection
  toolbar, and a ⌘K menu (New note, Copy link, Toggle theme, Insert table, Go home).
  Collaborators' carets show their name and colour.
- **Keep writing offline.** Edits stay in the page and sync when the connection returns.
  They are not saved on the device: closing the tab while offline loses them.

## Promises

- **The link is the key.** Ids are 128 random bits; there are no accounts and no listing.
  Anyone with a link can read and edit that note (D02).
- **Notes expire.** A note is deleted 90 days after its last visit (D06).
- **Notes stay out of search engines.** Note pages and the API are marked `noindex,
nofollow` and disallowed in `robots.txt`; only the landing page is indexable (D17).
- **Notes are small.** A note holds up to 2 MB of Yjs state. At 1.6 MB the page says
  "This note is almost full"; when an edit no longer fits, the page goes read only and says
  "This note is full. Start a new note to keep writing." (D05).
- **Newer notes open read only.** A note written in a document layout this version of the
  binding can't write opens read only rather than being misread.

## Not in scope

Accounts, permissions, version history, comments, search, export, and saving notes on
the device. jot is a playground, not a place to keep things.
