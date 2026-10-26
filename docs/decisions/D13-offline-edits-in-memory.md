# D13: Offline edits stay in memory until a Yjs 14 IndexedDB provider exists

Status: `DEFERRED`

## Context

There is no IndexedDB persistence provider for Yjs 14 (`@y/y`) yet; `y-indexeddb` targets
Yjs 13.

## Decision

Offline edits live in the page's `Y.Doc` and sync when the socket reconnects. The pill says
"Offline · will sync when you reconnect". Closing the tab while offline loses the
unsynced edits.

## Revisit when

A Yjs 14 IndexedDB provider ships. Then the pill can say "Saved on this device".
