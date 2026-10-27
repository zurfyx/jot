# D04: Lexical from pkg.pr.new at a pinned PR commit; single-copy rule; bump script

Status: `DECIDED`

## Context

`@lexical/y` is not on npm yet. facebook/lexical publishes every PR commit to pkg.pr.new.
Lexical must be a single copy per app: two copies of `lexical` break node identity and
editor state.

## Decision

- Every `lexical` and `@lexical/*` dependency comes from **one commit**, by its full-sha
  URL: `https://pkg.pr.new/facebook/lexical/<package>@<sha>`. Currently PR #9439's head,
  `e240f42c712c828a1eaecbb12f8ca4dbd21faf56`, which carries the whole `@lexical/y` stack
  including the headless API.
- Full shas, not 7-character ones: the published packages name their own Lexical
  dependencies by full-sha URL, so matching them keeps one resolution per package.
- `overrides` in `pnpm-workspace.yaml` pin every `@lexical/*` package (direct or
  transitive) to the same URLs. pnpm 11+ reads settings there, not from `package.json`;
  the file has no `packages:` list, so this is still a single package.
  `blockExoticSubdeps: false` lets pkg.pr.new packages depend on each other by URL.
- `scripts/bump-lexical.mjs <pr-or-sha>` resolves a PR to its head commit, checks
  pkg.pr.new serves it, and rewrites every URL in both files. Then `pnpm install` and
  `pnpm why lexical` (one version).

## Consequences

- Builds depend on pkg.pr.new staying up and keeping old commits.
- Moving to npm releases later is a one-shot edit of the same lines.
