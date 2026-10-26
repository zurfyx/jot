# D13: Offline edits stay in memory until a Yjs 14 IndexedDB provider exists

Status: `DEFERRED`

## Context

There is no IndexedDB persistence provider for Yjs 14 (`@y/y`) yet; `y-indexeddb` targets
Yjs 13.

## Decision

A note's offline edits (from losing the network, or from Work offline) live in the page's
`Y.Doc` and sync when the socket reconnects. The pill says "Offline · N edits waiting".
Closing the tab while offline loses the unsynced edits. Every note is shared from its first
moment (D23), so this holds for all of them.

## Revisit when

A Yjs 14 IndexedDB provider ships. Then the pill can say "Saved on this device".
