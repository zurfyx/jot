# D37: Unsent edits are kept on this device with `@lexical/y/offline`

Status: `PROPOSED`

## Context

Until now a page kept its offline edits in memory (D13): a reload or a closed tab lost
them, and a page whose note moved on (migrated to a newer layout, or created again after it
expired) uploaded its whole document to the note's quarantine, which listed it under ⋯ →
Offline edits for every visitor (D34). D13 waited for a Yjs 14 IndexedDB provider.
`@lexical/y/offline` (meta/lexical#9899, in the build jot pins) is one: an IndexedDB store
keyed by a document key and the epoch (generation) it was made against, and an offline
session on the binding that stores edits as they are made, lets them sync at the same epoch,
and on a moved epoch freezes the editor and keeps them as a capture, which
`recoverYOfflineEdits` describes block by block and, where safe, replays.

## Decision

- **A store per page, a session per note.** `editor/offline.ts` opens the store once
  (IndexedDB `lexical-y-offline`); each note session attaches the offline session to its
  binding at stage `replay` with `keep: 'unsynced'`: only what the server has not taken is
  kept, and `markSynced()` deletes it once the server has echoed every local update. Key:
  the note id. No write delay, and a flush on `pagehide`.
- **The epoch is the note's generation** (D34's `getYGeneration`, served in the fence's
  verdict). An admit or bootstrap verdict calls `serverEpoch(generation)`; a stale one calls
  it with the new generation, which freezes the binding and stores the capture. A page starts
  from the newest slot whose rows no live tab holds (a reload, a closed tab), at that slot's
  generation, so its handshake decides whether those edits sync or become a capture.
- **Offline edits are this device's.** After its first confirmed sync, a session recovers:
  slots closed tabs left at another generation become captures, captures older than 90 days
  go, and a capture whose every item and deletion the note already holds is dropped. ⋯ →
  Offline edits lists this device's captures ("On this device", View, Export, Remove) beside
  the note's records; the banner covers both.
- **Nothing is replayed yet.** jot's blocks carry no ids (no `BlockIdExtension`), so the
  reports match blocks by position and nothing is replayable; the person copies what they
  want back in. Edits that cannot merge will go into the note through the library's
  `leftovers` option (a quote labelled "Offline edits that didn't merge · <time>" after the
  conflicting block) once it ships; until then they stay listed.
- **The record upload stays as a fallback.** A browser without IndexedDB runs at stage `off`
  (edits in the page, as before) and uploads on a stale verdict; so does a page whose store
  refused the capture (quota, limit). A copy from a D18 build becomes a `legacy` capture,
  uploaded only where there is no store.
- **The server keeps its records** for the captures of pages from before the fence, the
  uploads above, and pages still running the release before this one, which upload on a
  stale verdict. Remove the upload route once none of those can remain: no page from before
  this release open, and its records past their 90 days.

## Why

- A reload or a closed tab losing typed text broke "nothing typed is lost"; the library now
  stores and captures by generation, which is the fence jot already has.
- Keeping a capture on the device that made it is private by default: a note's other
  visitors no longer see someone's offline copy, and the note's 256-record quota is not spent
  on them.
- `keep: 'unsynced'` stores nothing while a note is in sync, so jot still keeps no notes on
  the device (product.md).

## Consequences

- An unsent edit survives a reload, a crash or a closed tab in the same browser; in another
  browser it does not exist.
- Clearing the site's data drops this device's captures.
- A tab closed in the instant of a keystroke can lose that keystroke (each write is its own
  IndexedDB transaction).
- Replay waits for block ids, which would change what jot stores (a schema version, D29): a
  decision of its own.
- Supersedes D13. D34's handoff upload and its records-only list are now the fallback.
