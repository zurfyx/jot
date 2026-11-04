# D23: A new note is shared from its first moment

Status: `DECIDED` (supersedes D18)

## Context

D18 kept a new note in the browser at `/new` until someone pressed Share, so a visitor who
typed one word and left created nothing on the server. In use it read the wrong way: the
person landed on `jot.rovira.sh/new`, a link nobody else can open, and had to find Share
before the note was a jot. jot is a playground for collaboration; the link is the product
(D02), and it should be in the address bar from the first moment. It also cost a lot of
code: drafts, Share-to-convert, pending copies kept until the relay confirmed them, merged
writes across tabs, and a pill state of their own.

## Decision

- **Every start opens a shared note.** "Start a new note", ⌘↵, a printable key on the
  landing page, the New note card, the footer's New note, ⋯ → New note, ⌘K → New note,
  "Start a new note" in the full-note banner and the example's Start blank pick an id in
  the browser and open `/n/<id>`, connected to the relay like any note. The room is
  created by the first connection; the binding seeds the empty note after the first sync.
- **`/new` stays a link that works.** Loading it (an old link, a start link opened in a new
  tab) replaces the address with a fresh `/n/<id>`, with no history entry of its own.
  `/new?example` still opens the example (D20).
- **One note-page shape.** `createNoteSession(id)` always has an id and a provider; the
  pill has no draft state and Share only copies the link.
- **Migration from D18.** Nothing writes `jot:draft` or `jot:pending:<id>` any more. A
  browser that still holds them keeps their content:
  - the next new note (from any start, or a load of `/new`) takes `jot:draft`, at the
    moment it commits to opening (after the editor chunk has loaded), so a page left
    during a slow load claims nothing. The draft is copied to that note's
    `jot:pending:<id>` and removed only once the copy reads back; with no room for the
    copy, the draft stays and the note opens empty. The claim runs under a Web Lock
    (`jot:legacy-draft`) and re-reads the draft inside it, so two tabs starting notes at
    once can't take one draft into two notes. Storage that throws (denied) or a refused
    lock skip the migration; the note still opens;
  - every note page that opens hands each `jot:pending:<id>` to its own note's offline
    edits (D34): a copy has no generation the note can check, so it is uploaded as a
    record of its own and never merged into the note; it is removed from storage once the
    note acknowledges it or refuses it for good, and kept for the next page if the note
    could not be reached. An unreadable copy is dropped;
  - the moved draft shares the binding's content-derived seed with the new note's own
    first sync, so the note shows the draft once, without an extra empty line;
  - a tab still running the earlier version during the deploy can write `jot:draft` again
    after it was claimed; the next new note claims that too, so it lands in a second note
    rather than being lost.

## Consequences

- Every start makes a Durable Object and, after the first edit, a stored row. Empty notes
  expire after 90 days without visits like any other (D06); D16 covers abuse.
- A note can't be written privately first: anyone who learns its link can read it from the
  first keystroke. The link is 128 random bits (D02), so in practice that is whoever it is
  given to.
- Offline edits of every note live in memory until the socket reconnects (D13).
- A legacy copy's content shows under its note's Offline edits, as this browser's, rather
  than in the note: the person copies back what they want (D34).
- The migration code can go once old drafts are unlikely to exist: it is small and
  touches nothing else.
