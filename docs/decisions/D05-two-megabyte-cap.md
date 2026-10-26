# D05: 2 MB cap (Cloudflare's row limit), warn at 1.6 MB, periodic compaction

Status: `DECIDED`

## Context

A note is stored as one SQLite row, and Cloudflare caps a row at 2 MB. Yjs state only
grows unless deleted content is garbage collected.

## Decision

- A note's stored state may not exceed **2,000,000 bytes** (the conservative reading of
  "2 MB"; local workerd does not enforce the row limit, production does).
- The server checks each incoming update against an upper bound
  (`size + pending + update + 64`) and, only near the cap, measures
  `mergeUpdates([state, update])` exactly. An update that would pass the cap is not applied;
  its sender gets a note-status message with the rejected flag.
- The client shows "This note is almost full" at 1,600,000 bytes and goes read only with
  "This note is full. Start a new note to keep writing." when it reaches the cap or is
  told an update was rejected.
- **Compaction:** the server's document is gc-on and every save writes
  `encodeStateAsUpdate(doc)` as the one row, so each save (two seconds after activity, and
  when the last client leaves) is a compaction; loading on wake re-encodes again. Deleted
  history does not creep toward the cap.

## Consequences

- An edit rejected at the cap stays only in its author's page; the page is read only from
  then on, so nothing more is lost silently.
- The cap is per note, not per account; abuse limits are D16.
