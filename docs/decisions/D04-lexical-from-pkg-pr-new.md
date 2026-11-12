# D04: Lexical from one pinned build; single-copy rule; bump script

Status: `DECIDED`

## Context

Lexical must be a single copy per app: two copies of `lexical` break node identity and
editor state. `@lexical/y` has no stable release yet. meta/lexical publishes every commit
on `main` and every PR commit to pkg.pr.new, and a nightly of `main` to npm.

## Decision

- Every `lexical` and `@lexical/*` dependency comes from **one build**: an exact npm
  version (a release, or a nightly such as `0.53.1-nightly.20261106.0`), or one commit's
  pkg.pr.new build by its full-sha URL (`https://pkg.pr.new/meta/lexical/<package>@<sha>`),
  for a `main` commit (`0.53.1-main.g<sha>`) or a pull request. Use the long form
  (`pkg.pr.new/meta/lexical/<package>@<sha>`): the short form (`pkg.pr.new/<package>@<sha>`)
  does not resolve every package, and the packages name each other by the long form.
  Currently `main` at `e2836f0` (`0.53.1-main.ge2836f0`), which carries the whole
  `@lexical/y` stack (the layout migration API, layout 3) with its load-repair and
  composition-hold fixes, and the markdown shortcut fix for a node replaced before its
  queued update runs (meta/lexical#9868).
- Full shas for pkg.pr.new, not 7-character ones: those packages name their own Lexical
  dependencies by full-sha URL, so matching them keeps one resolution per package.
- `overrides` in `pnpm-workspace.yaml` pin every `@lexical/*` package (direct or
  transitive) to the same build. pnpm 11+ reads settings there, not from `package.json`;
  the file has no `packages:` list, so this is still a single package.
  `blockExoticSubdeps: false` lets pkg.pr.new packages depend on each other by URL.
- `scripts/bump-lexical.mjs <pr-or-sha>` (or `<version> <sha>`) resolves a PR to its head commit and checks
  pkg.pr.new serves it, or checks npm has the version, and rewrites every Lexical entry in
  both files. A version names the commit it was built from (`<version> <sha>`), kept as
  `lexicalCommit` in `package.json`, so the docs link `@lexical/y`'s source at that commit.
  Then `pnpm install` and `pnpm why lexical` (one version).

## Consequences

- A nightly is a moving name only by date: the exact version never changes, so a build is
  reproducible from the lockfile.
- A pkg.pr.new pin depends on pkg.pr.new staying up and keeping old commits.
