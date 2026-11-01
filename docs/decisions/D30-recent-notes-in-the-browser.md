# D30: Recently opened notes, kept in the browser and pruned after 90 days

Status: `DECIDED`

## Context

Returning to a note means finding its link again: jot has no accounts and no listing (D02),
so a note you opened yesterday is lost unless you kept the link. The landing page can offer
the notes this browser opened, as long as nothing about them leaves the browser.

Notes expire 90 days after their last visit (D06). When the alarm fires, the note's Durable
Object deletes all its storage; a later connection to the same id gets an empty room and
answers exactly as for a note nobody has written yet. The client can't tell an expired note
from a new or emptied one.

## Decision

- A list of recently opened notes lives in this browser's localStorage under `jot:recent`:
  for each note its id, its title (the first line, or "Untitled note"), the start of the
  text after the first line, when this browser last opened it, and whether it is the
  example this browser started. At most 20 entries, newest first. Nothing goes to the
  server.
- A note is recorded when its page opens, a new note too. Once the note has synced, its
  first line becomes the title as you type, at most one write every 2 s, and the latest is
  written at once when the page is hidden or closed and when you leave it. A note removed
  from the list while open stays removed.
- Because expiry can't be detected, an entry this browser hasn't opened for 90 days is
  pruned. A note someone else kept alive drops from the list too; opening its link brings it
  back.
- The landing page shows the list in a section right below the hero ("Your recent notes"):
  six entries in two columns of hairline rows (one column on a phone), then Show all; a
  remove button per entry, shown on hover and on keyboard focus and always on touch
  screens; Clear all, which asks first. With no entries the page is exactly what it was.
- The section is a slot of a fixed height: the inline script in `index.html` that sets the
  theme also marks `<html>` with whether there are entries and how many rows they take,
  before the first paint, and the section reads the list with `useSyncExternalStore` and an
  empty server snapshot. A prerendered landing page draws the slot empty at its final size
  and the client fills it in, so nothing moves.
- Opening an entry runs the landing page's view transition from its row: the row grows into
  the note page, as a card does.
- Tabs follow each other through the `storage` event. Where storage is denied the list is
  empty and nothing throws.

## Why

- localStorage keeps the playground's promise: no accounts, nothing about you on the server.
- A title from the first line matches how jot already names a note (`document.title`).
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
