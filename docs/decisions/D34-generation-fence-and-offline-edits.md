# D34: A generation fence per note; offline edits it cannot take wait under Offline edits

Status: `PROPOSED`

## Context

`@lexical/y` is moving to stored layouts that only a server may convert (its D102): the
note's Durable Object migrates a note in place on load, and a page that held edits against
the note as it was must not sync them into the note as it is (an old format item lands in a
new layout; a stale parent deletion can erase text written since). The same holds for a
note that expired and was created again under the same link (D06): a tab or a stored copy
from its earlier life must not merge into the new one. Every jot page keeps its edits in
memory only (D13), so the pages at risk are the ones open across such a change, and the
`jot:pending:<id>` copies D18 builds left behind.

## Decision

- **Generation.** Each note's object keeps a random 128-bit incarnation, made at the first
  visit that finds none and again whenever the note is created afresh after its expiry,
  and serves its generation (`@lexical/y/server`'s `getYGeneration`, version `g1`: the
  incarnation and each served root's last migration, none until a note migrates; opaque to
  everyone else). It is stored, never recomputed from the document per
  update. A note that already existed when the fence shipped gets an _inherited_
  incarnation.
- **Handshake.** A note page presents, in its socket URL, the version 1 handshake its
  `@lexical/y` builds: the generation its document belongs to (adopted only when a full
  sync with the note completed), whether it holds edits of its own, the layouts its release
  reads, the layout its seed records and the features it implements. The
  object answers with a verdict (`checkYSession`, message 65, sent only to sockets that
  presented the handshake): admit, bootstrap, stale or refuse-layout.
- **Stale: hand off, then open afresh.** A page whose edits were made against another
  generation never syncs. It stops its writers (in-tab peers too), commits what the editor
  holds (`binding.quiesce()`), uploads its whole document as one record and waits for the
  object's durable acknowledgement of exactly that upload (scoped to the note, the replica
  and its source generation, naming the upload's SHA-256), retrying the same bytes; only
  then does it open the note afresh. A page that cannot read the note reloads once.
- **Pages from before the fence** keep editing a note with an inherited, never-migrated
  incarnation as they always did. Anywhere else (a new note, a note created again, a
  migrated note) their whole document is kept as a record (a sync step 1 with an empty
  state vector makes their step 2 a standalone snapshot), and they are turned read only by
  an update built on that snapshot recording a schema version above jot's: the banner
  they already have says "reload to edit". Nothing of the note is ever sent to them.
- **Migration on first open.** A note whose layout is below the floor migrates in its
  object before anything is served, in place, behind a barrier with no await, the old
  state kept as the base of its generation. A note whose migrated state passes the 2 MB
  cap becomes a fresh document under a new incarnation.
- **Replay, later.** A handoff of the same incarnation, made against a generation the note
  migrated from in place, is to be replayed at the note as a checked edit (its text inserts
  and deletions by identity, a format change only where its earlier value is known and
  unchanged; the rest conflicts kept with the record). Deferred: the `@lexical/y` jot pins
  ships no replay; it comes with meta/lexical#9771. Until then every handoff waits under
  Offline edits.
- **Offline edits.** Records are kept in the object's SQLite (parts under the 2 MB row
  cap) for 90 days and go with the note at its expiry. ⋯ → Offline edits lists those that
  hold something the note lacks; a banner shows this browser's own. The object reads a
  record with jot's node set and the page shows it read only beside the note, with Copy
  text and a lossless Export.
- **Copies from D18 builds** are uploaded as records of their own, never merged into the
  note, and cleared from storage once acknowledged (D23).

## Why

- A generation outside the Yjs document is the only check that holds against an old
  update: a state vector cannot tell old pending edits from new ones, and a recreated note
  under the same link accepts an old copy's items (`@lexical/y` D102's reproductions).
- Saving the edits apart is what keeps the promise that nothing typed is lost, without
  merging edits made against content the note no longer has.

## Consequences

- A tab open across the deploy of a release that migrates notes is captured once and
  turns read only; its edits are under Offline edits. Notes not yet migrated are not
  affected.
- A page whose note changed while it was offline reconnects into a fresh copy of the
  note; its offline text is one click away, not in the note.
- Every record counts toward a per-note limit (256 records, 64 MB); past it, uploads are
  refused and the page keeps its edits on screen.
