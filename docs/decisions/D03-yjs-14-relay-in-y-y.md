# D03: Yjs 14 relay in `@y/y`, not yrs

Status: `DECIDED`

## Context

The Durable Object must speak the same sync and awareness protocol as the clients'
`@y/websocket` provider and hold a Yjs 14 document. Options: `@y/y` (the JavaScript Yjs 14
the clients run) or yrs (Rust, via WebAssembly).

## Decision

The relay is written with `@y/y`, pinned exactly to `14.0.0-rc.29`, the version
`@lexical/y` peers on. It implements the server half of the y-websocket protocol
(`@y/protocols` sync messages, awareness relay) directly; the published
`@y/websocket-server` still depends on pre-`@y/y` Yjs 14 prereleases.

## Why not yrs

- yrs before 0.28 misreads the 53-bit client ids Yjs 14 generates (`@lexical/y` has a
  `clientIDRange: 'uint32'` escape hatch for exactly this).
- One implementation on both ends means one set of semantics: what the server merges is
  what clients merge.

## Later

A yrs-backed relay could be an optional compatibility mode (with `uint32` client ids) if a
reason appears. Not planned.
