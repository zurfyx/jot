# D30: Recently opened notes, kept in the browser and pruned after 90 days

Status: `DECIDED`

## Context

Returning to a note means finding its link again: jot has no accounts and no listing (D02),
so a note you opened yesterday is lost unless you kept the link. The landing page can offer
the notes this browser opened, as long as nothing about them leaves the browser.

A note's id is its access key (D02): anyone holding it can read and edit the note. A list of
ids is a list of keys.

Notes expire 90 days after their last visit (D06). When the alarm fires, the note's Durable
Object deletes all its storage; a later connection to the same id gets an empty room and
answers exactly as for a note nobody has written yet. The client can't tell an expired note
from a new or emptied one.

## Decision

- A list of recently opened notes lives in this browser's localStorage under `jot:recent`,
  as `{ entries, removed, clearedAt }`. Each entry holds the note's id, its title (the first
  line, or "Untitled note"), the start of the text after the first line, when this browser
  last opened it, and whether it is the example this browser started. At most 20 entries,
  newest first. Nothing goes to the server.
- The ids in it are the notes' access keys, kept where the page's own script, and anything
  else that runs on jot's origin or reads the browser's profile, can read them. That is the
  same exposure the browser's history already gives the links, and Clear all removes them.
- A note is recorded when its page opens, a new note too. Once the note has synced, a change
  to its content marks the title stale; the text is read and written when the throttle lets
  a write through (at most every 2 s), when the page is hidden, and when you leave it. Caret
  moves and other selection-only updates are ignored.
- **Every tab writes through one lock.** A change takes the Web Lock `jot:recent`, re-reads
  the stored state inside it, applies itself and writes it back, so two tabs never
  interleave a read and a write. A removal leaves a tombstone (the note's id and when) and
  Clear all a `clearedAt`; a visit stamped before either is not recorded, and a title write
  only changes an entry that is still there. Every write also re-reads storage just before
  it writes and keeps the newer `clearedAt` and tombstones of the two, dropping any entry
  they cover. A title write reads the note's first line and excerpt when it runs, inside
  the lock (or at `pagehide`), never when it is queued, so a write that waited always
  writes the latest text and no older title can come back. Across tabs the last write
  wins, since both read the same synced note; no clock or per-tab order is compared, so a
  clock corrected backwards or two tabs writing in the same millisecond change nothing.
  Wall-clock time serves only for display and the 90-day prune. A change stays pending in
  its tab until a write that read it lands, so the page hiding while a write waits still
  writes, and a write that found the note unlisted is tried again.
- Where Web Locks are missing, and for the title written on `pagehide` (when the page may be
  gone before a lock is granted), the change runs at once, without the lock. It still
  merges with what storage holds a moment before it writes, so a Clear or a removal that
  has landed sticks; only one landing in the same instant, between that read and the
  write, can be lost. Tombstones older than the last Clear or than 90 days are dropped, and
  at most the newest 100 are kept. Other tabs learn of a change through the `storage`
  event.
- Because expiry can't be detected, an entry this browser hasn't opened for 90 days is
  pruned, checked against the current time on every read, not only on writes.
- The landing page shows the list in a section right below the hero ("Your recent notes"):
  six entries in two columns of hairline rows (one column on a phone), then Show all; a
  remove button per entry, shown on hover and on keyboard focus and always on touch screens
  (where it takes 38px of taps); Clear all, which asks first. The relative times refresh
  every minute while the page is visible. With no entries the page is exactly what it was.
- The focus follows the change: the question's Clear button when asked, Clear all again on
  Cancel or Escape, the hero's "Start a new note" after Clear, the first newly shown note
  after Show all, and after a removal the next note, else the previous one, else the hero's
  action.
- The section is a slot of a fixed height: the inline script in `index.html` that sets the
  theme also marks `<html>` with whether there are entries and how many rows they take,
  before the first paint, and the section reads the list with `useSyncExternalStore` and an
  empty server snapshot. A prerendered landing page draws the slot empty at its final size
  and the client fills it in, so nothing moves. Once the client renders, the slot sizes
  itself from the real list, hides when it is empty, and the mark on `<html>` is brought up
  to date whenever the section subscribes and on every change.
- Opening an entry runs the landing page's view transition from its row: the row grows into
  the note page, as a card does.
- Where storage is denied the list is empty and nothing throws.

## Why

- localStorage keeps the playground's promise: no accounts, nothing about you on the server.
- A title from the first line matches how jot already names a note (`document.title`).
- One lock and a fresh read per change make concurrent tabs safe without a merge format;
  tombstones cover what a lock can't order, a visit stamped before a removal but written
  after it; reading the title when the write runs, rather than when it is queued, leaves
  no stale title to order at all.
- Pruning at 90 days never lists a deleted note: a note lives at least 90 days past this
  browser's last visit. Marking an entry "expired" from an empty room would also mark notes
  someone emptied.
- The section is below the hero, so the hero stays the same for everyone; in the mocks it
  was the most legible placement and it scales to many notes.

## Consequences

- Clearing site data, another browser or a private window means another list.
- The count rule in `index.html` must match `parseRecent` in `src/client/recent.ts`; an
  end-to-end test checks the reserved rows against the rendered ones.
- The list may drop a note that is still alive, when others kept visiting it; it never keeps
  one that is gone.
- Without the lock (a browser without Web Locks, or `pagehide`), two tabs changing the list
  in the same instant can still lose one change, a Clear included.
