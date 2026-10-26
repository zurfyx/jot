# D10: CI topology, deploy-on-green and PR previews

Status: `DECIDED`

## Decision

One workflow, **`ci.yml`**, runs on pushes to `main` and on pull requests, with
`contents: read`, and cancels superseded runs except on `main`. It has five jobs:

- `static`: lint, typecheck, format check, build;
- `test`: Vitest, unit and workers;
- `e2e`: Playwright Chromium against the dev server, uploading traces on failure. It runs in
  the official `mcr.microsoft.com/playwright` image whose tag matches the exact
  `@playwright/test` version, so Chromium and its system libraries come with the image and
  the job installs no browser. `@playwright/test` is pinned exactly; the image tag and the
  pin move together.
- `deploy`: `needs` `static`, `test` and `e2e` and runs only on a push to `main` in
  `zurfyx/jot`. It deploys only if its sha is still the tip of `origin/main`, so stale
  re-runs and the intermediate commits of a fast merge train are skipped: production is the
  latest green tip of `main`, not every green commit. It checks out that sha, installs,
  builds, and runs `cloudflare/wrangler-action@v3` with `deploy`. It deploys to the
  `production` environment (`https://jot.rovira.sh`), in concurrency group `deploy`, never
  cancelled.
- `preview`: `needs` `static` and `test` and runs only on a pull request whose head
  repository is `zurfyx/jot`. It deploys the PR as its own Worker (below) and posts one
  sticky comment with the preview URL, updated on every push. It has `pull-requests: write`
  for that comment and nothing else.

A second workflow, **`preview-cleanup.yml`**, runs when a same-repo pull request closes,
merged or not: it deletes that PR's preview Worker and marks the comment as removed.

`static`, `test` and `e2e` are the required checks (D08). `deploy` and `preview` are not: on
a pull request `deploy` shows as skipped, and on `main` so does `preview`.

Both deploy jobs use the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets;
previews need only the account's Workers Scripts edit permission. No account id in
`wrangler.jsonc`; CI provides it.

## PR previews

Every pull request from this repository gets a live copy of jot at
`https://jot-pr-<number>.<account subdomain>.workers.dev`, like a Vercel preview: reviewers
open the link and try the change, two windows on one note included.

Cloudflare's own Workers preview URLs (per-version and per-alias) are not generated for
Workers that use Durable Objects, and jot's whole server is one. So each PR deploys a
**separate Worker**, `wrangler deploy --name jot-pr-<number>`, built with the `preview`
environment in `wrangler.jsonc` (`CLOUDFLARE_ENV=preview pnpm build`; the Vite plugin bakes
the environment into `dist/jot/wrangler.json`). That environment:

- has `routes: []`, since routes are inheritable and production's custom domain would
  otherwise come along, and `workers_dev: true`, so the Worker is reachable only on
  workers.dev;
- declares its own `NOTES` binding to `NoteRoom` and its own `v1` migration, with no
  `script_name`. A separate Worker owns a separate Durable Object namespace, so preview
  notes never touch production's, and deleting the Worker deletes them.

The job checks the built config is the preview environment, with no routes and no
`script_name`, before deploying. The deploy always names `jot-pr-<number>` explicitly, so it
can never update the Worker named `jot`.

Cleanup runs wrangler outside the checkout, where no config exists, with
`delete --name jot-pr-<number> --force` behind a name pattern check, so a bad name can never
fall back to `jot`. A PR that never deployed (Cloudflare error 10090, no such Worker) is not
a failure. The `preview` job and the cleanup share the concurrency group
`preview-<number>`: the cleanup cancels a deploy in flight, and a deploy that starts after
the PR closed checks the PR state and skips, so no preview outlives its PR.

Previews are never built for a fork's pull request: its code would run with the deploy
token, and GitHub withholds the secrets from it anyway. Those PRs are verified by the three
checks alone, as every PR is: the e2e job runs the same Worker and Durable Object in workerd
against the local dev server.

## Why one workflow

Keeping production's deploy in `ci.yml`, rather than a separate `workflow_run` workflow,
means a deploy run exists only for pushes to `main`, sits next to the checks that gate it,
and adds no skipped check to `main` for every PR's CI run. The preview deploy lives there
too for the same reason: it waits on the checks of the same run. Only the cleanup, which
answers a different event, is its own workflow.
