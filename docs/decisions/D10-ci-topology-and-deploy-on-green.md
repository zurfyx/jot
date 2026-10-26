# D10: CI topology and deploy-on-green

Status: `DECIDED`

## Decision

- **`ci.yml`** runs on pushes to `main` and on pull requests, with `contents: read`, and
  cancels superseded runs except on `main`. Three jobs, which are the required checks:
  - `static`: lint, typecheck, format check, build;
  - `test`: Vitest, unit and workers;
  - `e2e`: Playwright Chromium against the dev server, uploading traces on failure.
- **`deploy.yml`** runs on `workflow_run` of CI and deploys only when the run succeeded, its
  branch is `main`, its head repository is this repository (a fork PR from a branch named
  `main` must never deploy), and its sha is still the tip of `origin/main` (stale re-runs
  and superseded commits are skipped). It checks out that sha, installs, builds, and runs
  `cloudflare/wrangler-action@v3` with `deploy`, using the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` secrets. Concurrency group `deploy`, never cancelled.
- No account id in `wrangler.jsonc`; CI provides it.

## No PR previews

Cloudflare does not generate Workers preview URLs for Workers that use Durable Objects, so
there are no per-PR preview deployments. PRs are verified by the e2e job against the local
dev server, which runs the same Worker and Durable Object in workerd.
