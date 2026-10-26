# D10: CI topology and deploy-on-green

Status: `DECIDED`

## Decision

One workflow, **`ci.yml`**, runs on pushes to `main` and on pull requests, with
`contents: read`, and cancels superseded runs except on `main`. It has four jobs:

- `static`: lint, typecheck, format check, build;
- `test`: Vitest, unit and workers;
- `e2e`: Playwright Chromium against the dev server, uploading traces on failure. It runs in
  the official `mcr.microsoft.com/playwright` image whose tag matches the exact
  `@playwright/test` version, so Chromium and its system libraries come with the image and
  the job installs no browser. `@playwright/test` is pinned exactly; the image tag and the
  pin move together.
- `deploy`: `needs` the other three and runs only on a push to `main` in `zurfyx/jot`. It
  deploys only if its sha is still the tip of `origin/main`, so stale re-runs and the
  intermediate commits of a fast merge train are skipped: production is the latest green
  tip of `main`, not every green commit. It checks out that sha, installs, builds, and runs
  `cloudflare/wrangler-action@v3` with `deploy`, using the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` secrets. It deploys to the `production` environment
  (`https://jot.rovira.sh`), in concurrency group `deploy`, never cancelled.

`static`, `test` and `e2e` are the required checks (D08). `deploy` is not: on a pull request
it shows as skipped.

The deploy job is the only one that reads secrets, and it never runs on `pull_request`, so
no PR run, from this repository or a fork, can reach them. Keeping the deploy in the same
workflow, rather than a separate `workflow_run` workflow, means a deploy run exists only for
pushes to `main`, sits next to the checks that gate it, and adds no skipped check to `main`
for every PR's CI run.

No account id in `wrangler.jsonc`; CI provides it.

## No PR previews

Cloudflare does not generate Workers preview URLs for Workers that use Durable Objects, so
there are no per-PR preview deployments. PRs are verified by the e2e job against the local
dev server, which runs the same Worker and Durable Object in workerd.
