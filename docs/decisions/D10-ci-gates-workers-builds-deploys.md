# D10: CI gates merges; Cloudflare Workers Builds deploys

Status: `DECIDED`

## Decision

Two systems, each doing one job:

- **GitHub Actions gates merges.** `ci.yml` runs on pushes to `main` and on pull requests,
  cancelling superseded runs except on `main`. It holds no Cloudflare credential and
  deploys nothing.
- **Cloudflare Workers Builds deploys.** The `jot` Worker is connected to `zurfyx/jot` in the
  Cloudflare dashboard (Worker > Settings > Build). Every push to `main` runs
  `pnpm run build` and `npx wrangler deploy`: production at jot.rovira.sh. Every push to any
  other branch of the repository runs `pnpm run build` and `npx wrangler preview`: that
  branch's Preview (D24).

## The merge gate

`ci.yml` has four jobs:

- `static`: lint, typecheck, format check, build;
- `test`: Vitest, unit and workers;
- `e2e`: Playwright Chromium against the dev server, uploading traces on failure. It runs in
  the official `mcr.microsoft.com/playwright` image, pinned by tag and digest, whose tag
  matches the exact `@playwright/test` version, so Chromium and its system libraries come
  with the image. The pin, the tag and the digest move together.
- `zizmor`: audits `.github/` with [zizmor](https://docs.zizmor.sh) at the pedantic persona
  and fails on any finding.

`static`, `test` and `e2e` are the required checks, and `main` requires branches to be up to
date before merging (D08), so the squash commit that lands is the tree CI tested. That is the
release gate: Workers Builds deploys every push to `main` without waiting for CI on `main`,
which runs again only as a record.

Workflow hygiene, after the OWASP and GitHub hardening guides:

- `permissions: contents: read` at the workflow level and again on every job. The
  repository's default workflow token is read-only and cannot approve pull requests
  (Settings > Actions > General).
- Every action is pinned to a full commit sha with its version in a comment, and checkouts
  do not persist the token.
- `.github/dependabot.yml` proposes GitHub Actions bumps weekly, as one grouped PR, after a
  seven-day cooldown. npm dependencies are updated by hand (below).

## Seeing builds and deploys

- **On GitHub:** the Cloudflare Workers and Pages GitHub App adds a check run,
  `Workers Builds: jot`, to each commit it builds, beside CI's checks on the pull request.
  Its Details link opens that build's log in the Cloudflare dashboard. The check is not
  required; CI's three are. The app also keeps one comment on the pull request with a row
  per build, but it can lag the check or miss a build's URL, so trust the check and take
  the Preview URL from the pattern in D24 or from the dashboard.
- **In Cloudflare:** Workers & Pages > `jot` > Deployments for production, and the Preview
  dropdown for each branch's Preview, with its builds, deployments, logs and metrics.

## The trust boundary

- **No Cloudflare secret in GitHub.** The build token lives in Cloudflare, attached to the
  Workers Builds connection. It has Workers Scripts edit and Account Settings read for the
  account, User Details and Memberships read, and Workers Routes and SSL and Certificates
  edit on the `rovira.sh` zone only: enough to deploy the Worker and its custom domain.
- **Same-repo branches are trusted.** Workers Builds builds every branch pushed to
  `zurfyx/jot`, and a branch's build installs that branch's dependencies and runs its own
  `package.json` scripts with the build token, which can deploy production. Only the owner,
  his agents and Dependabot push branches here. Fork pull requests get CI only.
- **No automated npm updates.** A Dependabot npm PR would be a same-repo branch whose
  Preview builds, with the token, as soon as it opens: a compromised release of any
  dependency (wrangler, Vite, a plugin) would run with production-capable credentials
  before anyone read the PR. So npm updates are made by hand, on a branch someone chose to
  push. Dependabot proposes only GitHub Actions bumps: those change files under `.github/`,
  run in GitHub with the read-only token, and leave what Workers Builds installs unchanged.

Hardening, if more people ever push to the repository: keep branches out of preview builds
with the preview trigger's `branch_excludes` (the Workers Builds API; the dashboard offers
only on or off, under Worker > Settings > Build > Branch control), or move previews to a
Worker in a second Cloudflare account with its own connection and token.

## Why

Workers Builds already holds the token, deploys with the Worker's own settings, and posts
the Preview URL on the PR. Deploying from GitHub Actions instead meant a Cloudflare token readable by every same-repo workflow run, a separate Worker per
pull request (Cloudflare's version preview URLs do not support Durable Objects), and a
cleanup workflow on `pull_request_target`. Worker Previews give each branch its own Durable
Object namespace under the same Worker, so none of that is needed.

## Consequences

- Production is the latest push to `main`, deployed in the order Workers Builds runs them,
  not "the latest green tip": a red `main` still deploys. The up-to-date and required-check
  rules keep a red commit from landing on `main` in the first place.
- Deploys, rollbacks and build settings live in the Cloudflare dashboard, not in this
  repository. The build and deploy commands there are `pnpm run build`,
  `npx wrangler deploy` and `npx wrangler preview`; change them only together with this
  file.
