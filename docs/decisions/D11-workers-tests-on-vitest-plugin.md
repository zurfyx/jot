# D11: Durable Object tests on `@cloudflare/vitest-plugin`

Status: `DECIDED`

## Decision

The workers test project uses `@cloudflare/vitest-plugin`, the renamed and maintained
successor of `@cloudflare/vitest-pool-workers` (which is deprecated and no longer
updated). It runs the real Worker and `NoteRoom` in workerd with SQLite storage, and
provides `evictDurableObject` and `runDurableObjectAlarm` for the eviction and expiry
tests.
