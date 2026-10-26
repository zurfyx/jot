# D08: PR workflow: protected main, PRs only, required checks, squash merge

Status: `DECIDED`

## Decision

- `main` is protected: changes land only through pull requests.
- Required status checks: `static`, `test`, `e2e` (the CI job names; renaming a job means
  updating the rule in the same change).
- Squash merge only, so `main` is one commit per PR.
- The rules include administrators: the owner follows them too.
- Commits are authored by Gerard, with concise imperative subjects and no AI trailers.

## Consequences

Because Workers Builds deploys every push to `main` (D10), the PR review and the required
checks are the release gate.
