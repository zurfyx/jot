# D24: Branch Previews on rovira.workers.dev

Status: `DECIDED`

## Decision

- Every branch pushed to `zurfyx/jot` other than `main` gets a Cloudflare
  [Worker Preview](https://developers.cloudflare.com/workers/previews/), built by Workers
  Builds (D10): a copy of jot under the same Worker, with its own settings and its own
  Durable Object namespace.
- A Preview answers on the account's workers.dev subdomain:
  `https://<preview-name>-jot.rovira.workers.dev` always serves the branch's latest
  deployment, and `https://<deployment-id>-jot.rovira.workers.dev` one exact deployment.
  The preview name is the branch name, slugified (`ci/workers-builds` becomes
  `ci-workers-builds`). Workers Builds comments both on the pull request.
- Production has no workers.dev URL: it answers only on jot.rovira.sh.
- Every Preview response carries `X-Robots-Tag: noindex`.

## How

`wrangler.jsonc` holds it all. The production deploy applies the URL settings; each
`wrangler preview` reads the branch's own `previews` block.

- **URLs.** `"workers_dev": false` turns off production's workers.dev URL and
  `"preview_urls": true` turns on Preview URLs there; Cloudflare sets the two separately.
- **The `previews` block.** Previews inherit nothing but assets, compatibility settings,
  migrations and observability. The block repeats the `NOTES` Durable Object binding (the
  Worker reads `env.NOTES`; without it a Preview fails with error 1101) and sets
  `vars.JOT_ENV` to `preview`, against `production` at the top level. Migrations stay at
  the top level; each Preview runs them into its own new namespace. No `script_name`, ever:
  it would point a Preview at production's notes. No routes or crons in the block: those
  always target production.
- **Noindex.** Cloudflare adds `X-Robots-Tag: noindex` to workers.dev Preview URLs. The
  Worker also marks every response it serves `noindex, nofollow` when `JOT_ENV` is
  `preview`, so the rule holds wherever a Preview is served from (D17 covers notes and the
  API in production).

## Why

- A Preview's notes are isolated from production by Cloudflare rather than by a config
  script: Durable Objects in a Preview get a namespace of their own, deleted with the
  Preview.
- workers.dev needs no DNS record, certificate or production deploy per hostname, and
  Cloudflare marks it noindex. A custom-domain alternative was ruled out for now:
  `<preview-name>.previews.rovira.sh` would work on the free plan (Cloudflare issues the
  `*.previews.rovira.sh` certificate with the domain; only hostnames a level deeper need
  Advanced Certificate Manager), but it is not noindex by default, and the domain applies
  only through a production deploy.
- Previews stay public, like production, so anyone reviewing a PR can open two windows on
  one note. Cloudflare Access would keep crawlers and strangers out entirely, at the cost
  of a sign-in; noindex is enough for a playground whose notes are public by link anyway.

## Consequences

- A Preview outlives its branch: Workers Builds creates Previews but does not delete them
  when a PR closes. The free plan keeps 100 Previews per Worker and deletes the least
  recently deployed one past that, notes included. Delete one sooner with
  `npx wrangler preview delete --name <preview-name>`.
- URL settings change only through a production deploy: a branch that edits them sees the
  change after it merges, not in its own Preview.
