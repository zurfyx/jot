# jot: Decision Register

The complete, ordered list of decisions that shape jot. If something isn't decided, it is
listed here with its status.

A `DECIDED` row is not re-litigated unless new evidence appears. A new consequential
decision gets a row here and its own file in the same commit.

## Status legend

| Status     | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `DECIDED`  | Ratified. A decision file exists. Do not re-open without new evidence. |
| `PROPOSED` | Recommendation on the table, awaiting the owner's ratification.        |
| `OPEN`     | Genuinely undecided; needs research or the owner's call.               |
| `DEFERRED` | Deliberately not decided until something forces it.                    |

## Blast radius

How expensive is this to get wrong?

| Radius   | Meaning                                                           |
| -------- | ----------------------------------------------------------------- |
| **HIGH** | Expensive to reverse: data migrations or a rewrite. Get it right. |
| **MED**  | Annoying to reverse: a refactor. Choose carefully, don't agonise. |
| **LOW**  | Cheap to reverse. Pick a sane default and move on.                |

---

## Tier 1: hard to reverse

| ID                                                   | Decision                                                      | Radius | Status    |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------ | --------- |
| [D01](D01-workers-sqlite-durable-object-per-note.md) | Workers + one SQLite Durable Object per note, Hibernation API | HIGH   | `DECIDED` |
| [D02](D02-the-link-is-the-key.md)                    | The link is the key; 128-bit ids; no fixed ids                | HIGH   | `DECIDED` |
| [D03](D03-yjs-14-relay-in-y-y.md)                    | Yjs 14 relay in `@y/y`, not yrs                               | HIGH   | `DECIDED` |
| [D05](D05-two-megabyte-cap.md)                       | 2 MB cap (Cloudflare's row limit), warn at 1.6 MB, compaction | HIGH   | `DECIDED` |

## Tier 2: moderate

| ID                                            | Decision                                                                | Radius | Status    |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------ | --------- |
| [D04](D04-lexical-from-pkg-pr-new.md)         | Lexical from pkg.pr.new at a pinned PR commit; single copy; bump script | MED    | `DECIDED` |
| [D06](D06-ninety-day-expiry.md)               | 90-day expiry without visits                                            | MED    | `DECIDED` |
| [D08](D08-pr-workflow.md)                     | PR workflow: protected main, required checks, squash merge              | MED    | `DECIDED` |
| [D10](D10-ci-topology-and-deploy-on-green.md) | CI topology and deploy-on-green; no PR previews                         | MED    | `DECIDED` |
| [D12](D12-presence-through-awareness.md)      | Presence: names, colours and carets through awareness                   | LOW    | `DECIDED` |
| [D14](D14-lexical-without-lexical-react.md)   | The editor is built with the extension API, without `@lexical/react`    | LOW    | `DECIDED` |
| [D07](D07-design-direction.md)                | Design: editor direction A, landing direction 2, Geist                  | LOW    | `DECIDED` |
| [D09](D09-docs-are-rewritten.md)              | Docs are rewritten, never amended                                       | LOW    | `DECIDED` |
| [D11](D11-workers-tests-on-vitest-plugin.md)  | Durable Object tests on `@cloudflare/vitest-plugin`                     | LOW    | `DECIDED` |
| [D15](D15-no-public-note.md)                  | No public note: abuse on a personal domain, and anyone can fill it      | LOW    | `DECIDED` |
| [D17](D17-notes-out-of-search-engines.md)     | Notes and the API are `noindex, nofollow` and disallowed in robots.txt  | LOW    | `DECIDED` |

## Tier 3: open, or deferred until something forces it

| ID                                    | Decision                                                              | Status     | Forced by                   |
| ------------------------------------- | --------------------------------------------------------------------- | ---------- | --------------------------- |
| [D13](D13-offline-edits-in-memory.md) | Offline edits stay in memory until a Yjs 14 IndexedDB provider exists | `DEFERRED` | a Yjs 14 IndexedDB provider |
| [D16](D16-abuse-limits.md)            | Abuse limits: rate limits and connection caps                         | `DEFERRED` | traffic or abuse            |
