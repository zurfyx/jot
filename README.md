# jot

Live collaborative notes at **[jot.rovira.sh](https://jot.rovira.sh)**. Open a note, share its
link, and everyone with the link edits the same page at the same time.

jot is a public playground for [`@lexical/y`](https://github.com/facebook/lexical/tree/main/packages/lexical-y),
Lexical's collaboration binding for Yjs 14, before its npm release. The editor is
[Lexical](https://lexical.dev); the server is a Cloudflare Worker with one Durable Object per
note, relaying Yjs 14 (`@y/y`) updates and storing each note as a single SQLite row.

- No accounts. A note's link is its key: anyone with it can read and edit.
- Notes are deleted after 90 days without a visit. Don't paste anything private.
- Notes stay out of search engines; only the landing page is indexable.
- A note holds up to 2 MB of Yjs state.

## Quick start

Node 24 and pnpm (the version in `package.json`'s `packageManager`).

```bash
pnpm install
pnpm dev          # http://localhost:5173: the client, the Worker and its Durable Objects
```

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`    | TypeScript, strict, client + worker + tooling                  |
| `pnpm lint`         | ESLint                                                         |
| `pnpm format:check` | Prettier                                                       |
| `pnpm test`         | Vitest: unit tests, and the Durable Object inside workerd      |
| `pnpm e2e`          | Playwright against the dev server                              |
| `pnpm build`        | Production build of the client and the Worker                  |
| `pnpm bump-lexical` | `pnpm bump-lexical <pr-or-sha>`: move Lexical to another build |

## Deploys

Cloudflare Workers Builds deploys every push to `main` to jot.rovira.sh, and builds every
other branch as a Preview at `<preview-name>-jot.rovira.workers.dev` (the branch name,
slugified), with its own notes. GitHub Actions only runs CI and holds no
Cloudflare secret: `static`, `test` and `e2e` must pass to merge, and `zizmor` audits the
workflows on every run. Builds and deploys show as a `Workers Builds` check on each commit and in the
Cloudflare dashboard under Workers & Pages > `jot`. See
[D10](docs/decisions/D10-ci-gates-workers-builds-deploys.md) and
[D24](docs/decisions/D24-previews-on-workers-dev.md).

## Layout

```
src/client/    landing page and note editor (React, Lexical, @lexical/y, @y/websocket)
src/worker/    Worker routes and the NoteRoom Durable Object (the Yjs 14 relay)
src/shared/    note ids, link parsing, size limits, protocol constants
e2e/           Playwright specs
scripts/       bump-lexical.mjs
docs/          product, architecture, design, testing, and the decision register
```

Start with [`docs/product.md`](docs/product.md) and
[`docs/architecture.md`](docs/architecture.md); every consequential choice is in
[`docs/decisions/`](docs/decisions/README.md).

## License

[MIT](LICENSE) © 2026 Gerard Rovira
