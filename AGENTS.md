# jot

Live collaborative notes on Lexical and Yjs 14: a public playground for `@lexical/y` at
jot.rovira.sh. One Cloudflare Worker serves the client; one SQLite-backed Durable Object per
note relays Yjs updates and stores the note.

## Read before working

- `docs/product.md`: what jot is and what it promises (authoritative product intent)
- `docs/architecture.md`: the current system shape and the wire protocol
- `docs/design.md`: the look, and the rules it follows
- `docs/testing.md`: what each test layer covers
- `docs/decisions/README.md`: **the decision register.** Every consequential choice lives
  here with status and blast radius. `DECIDED` rows are not re-litigated without new
  evidence. When you make a new consequential decision, add a row and its file in the same
  commit.

## Commands

```bash
pnpm install          # single package; pnpm-workspace.yaml holds settings only
pnpm dev              # vite + workerd on :5173 (client, Worker, Durable Objects)
pnpm typecheck        # strict TS (tsc -b): must pass before every commit
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm test             # Vitest: unit (Node) + workers (workerd, real SQLite)
pnpm e2e              # Playwright against its own dev server on :5174
pnpm e2e:docker       # Playwright in CI's image, with the visual suite (screenshots)
pnpm build            # client assets + Worker bundle in dist/
pnpm exec wrangler deploy --dry-run   # after pnpm build: checks the deploy bundle
pnpm bump-lexical <pr-or-sha>         # then pnpm install
```

After changing bindings in `wrangler.jsonc`, regenerate the Worker types:
`pnpm cf-typegen`.

## Conventions

- TypeScript strict everywhere; `pnpm typecheck` green before every commit.
- **Single package.** No workspace: a package is earned.
- **Lexical comes from one pkg.pr.new commit** (D04). Every `lexical` and `@lexical/*`
  URL in `package.json` and the `overrides` in `pnpm-workspace.yaml` names the same sha;
  change them only with `scripts/bump-lexical.mjs`. `pnpm why lexical` must show one
  version.
- **`@y/y` is pinned exactly** (`14.0.0-rc.29`), matching `@lexical/y`'s peer dependency.
  The relay uses `@y/y` too, never yrs (D03).
- Wire constants live in `src/shared/protocol.ts`; ids, limits and link parsing in
  `src/shared/`. Client and Worker import them from there; never duplicate them.
- **Docs are rewritten, never amended** (D09): when reality changes, rewrite the doc to
  read as if written fresh today. Git is the changelog.
- Design: tokens are StyleX `defineVars` in `src/client/theme/tokens.stylex.ts` (their dark
  values in `globals.css`, scoped sets with `createTheme` in `themes.ts`), no raw colours
  elsewhere; styles are
  `stylex.create` beside each component, and `src/client/globals.css` takes only what StyleX
  can't express, each rule with its reason (D28); one accent; motion only on state change,
  off under reduced motion (D07, `docs/design.md`).
- **Every feature ships with tests**: unit or workers tests in Vitest, a Playwright
  spec for anything a person does in the browser, and visual baselines (D27) for anything
  it shows, taken with `pnpm e2e:docker e2e/visual --update-snapshots`.
- Workflow (D08): branch per unit of work, PR to `main`, never commit to `main` directly.
  Required checks: `static`, `test`, `e2e`. Squash merge. Commits: concise imperative
  subject, authored by the repo owner, no AI trailers.
- Never deploy by hand. Cloudflare Workers Builds deploys every push to `main`, and builds
  every other branch as a Preview at `<preview-name>-jot.rovira.workers.dev`, the branch
  name slugified (D10, D24). GitHub Actions only gates merges; it holds no Cloudflare secret.
- Workflows: every action pinned to a full commit sha with a version comment, `contents:
read` permissions, checkouts with `persist-credentials: false`. The `zizmor` CI job must
  stay clean.

## Verification

- After UI changes: run `pnpm e2e:docker e2e/visual` (docs/testing.md), then `pnpm dev`,
  open the landing page and a note in light and dark, at 1440px and 390px wide, and look
  at them. Open the same note in two windows and type in both.
- After Worker changes: `pnpm test` (the workers project runs the Durable Object in
  workerd with real SQLite storage, eviction and alarms), then `pnpm e2e`.
- Before a PR: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e`
  (the pre-push hook runs all but e2e).
- Sandboxed agent shells on macOS can't launch Chromium normally (mach port rendezvous is
  denied). Run e2e there with `JOT_E2E_SINGLE_PROCESS=1 pnpm e2e`: each test gets its own
  single-process browser. Machine-specific notes go in `AGENTS.local.md` (gitignored).
