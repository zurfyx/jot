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

A second workflow, **`preview-cleanup.yml`**, deletes previews: when a same-repo pull
request closes, merged or not, it deletes that PR's Worker and marks the comment as removed,
and a weekly sweep (also runnable by hand) deletes any `jot-pr-*` Worker whose PR is closed.

`static`, `test` and `e2e` are the required checks (D08). `deploy` and `preview` are not: on
a pull request `deploy` shows as skipped, and on `main` so does `preview`.

## PR previews

Every pull request from this repository gets a live copy of jot at
`https://jot-pr-<number>.<account subdomain>.workers.dev`, like a Vercel preview: reviewers
open the link and try the change, two windows on one note included.

Cloudflare's own Workers preview URLs (per-version and per-alias) are not generated for
Workers that use Durable Objects, and jot's whole server is one. So each PR deploys a
**separate Worker**, `jot-pr-<number>`. A separate Worker owns a separate Durable Object
namespace, so preview notes never touch production's, and deleting the Worker deletes them.

The job builds with the `preview` environment in `wrangler.jsonc`
(`CLOUDFLARE_ENV=preview pnpm build`; the Vite plugin bakes it into
`dist/jot/wrangler.json`), then `scripts/preview-config.mjs` writes the config that is
actually deployed, `dist/jot/wrangler.preview.json`. Everything that decides what a preview
can touch is a constant in that script, not copied from the build: the name
`jot-pr-<number>`, `routes: []` (routes are inheritable, and production's custom domain
would otherwise come along), `workers_dev: true`, one `NOTES` binding to its own `NoteRoom`
with no `script_name`, and one `v1` migration that only creates `NoteRoom`. The build
contributes only the bundle, assets and compatibility settings, and the script refuses the
deploy if the build carries anything else: routes, a `script_name`, transferred, renamed or
deleted classes (a transfer from `jot` would move production's notes into the preview, and
the cleanup would then delete them), or any other binding or trigger. Its unit tests pin
those refusals.

The job deploys only if its run is for the PR's current head and the PR is still open, so a
re-run of an older commit never overwrites a newer preview and a run that finishes after
the PR closed never recreates a deleted one. It shares the concurrency group
`preview-<number>` with the cleanup, which cancels a deploy in flight.

The cleanup runs on `pull_request_target`, so it runs even for a PR that conflicts with
`main` or was retargeted, and always runs `main`'s copy of the workflow. It never checks out
or runs the PR's code: it installs `main` for wrangler and takes only the PR number.
`scripts/remove-preview.sh` runs `wrangler delete --name jot-pr-<number> --force` outside
the checkout, where no config exists, behind a name pattern check, so a bad name can never
fall back to `jot`. A Worker that is already gone (Cloudflare error 10090) is not a failure.

## The trust boundary

Both deploy jobs use the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets; previews need the account's Workers Scripts edit permission. No account id in
`wrangler.jsonc`; CI provides it.

- **Forks never get the secrets.** GitHub withholds them from a fork's `pull_request` run,
  and the `preview` job does not run for one. Fork PRs are verified by the three checks
  alone; the e2e job runs the same Worker and Durable Object in workerd.
- **Same-repo branches are trusted.** Only the owner and his agents push to `zurfyx/jot`. A
  same-repo PR runs its own copy of `ci.yml` and its own scripts with a token that can edit
  every Worker on the account, production included.
- **The guards prevent accidents, not malice.** The preview config builder, the name checks
  and the head and state checks stop a mistaken config or a stale run from touching
  production. A malicious same-repo branch could rewrite them in the same PR; no code in
  this repository can stop that.

Hardening, if the set of people who push to the repository ever grows: give previews their
own Cloudflare account and token, so a preview token cannot reach production at all, and
move production's token into a secret of the `production` GitHub environment, restricted to
`main`, so PR runs cannot read it.

## Why one workflow

Keeping production's deploy in `ci.yml`, rather than a separate `workflow_run` workflow,
means a deploy run exists only for pushes to `main`, sits next to the checks that gate it,
and adds no skipped check to `main` for every PR's CI run. The preview deploy lives there
too for the same reason: it waits on the checks of the same run. Only the cleanup, which
answers other events, is its own workflow.
