# D22: The docs live in the app, with snippets that compile

Status: `DECIDED`

## Decision

- `/docs` and `/docs/<slug>` are routes of the same single-page app, served by the same
  Worker (unknown paths already fall back to `index.html`). There is no second site, build
  or deploy.
- Pages are React components in `src/client/docs/`, loaded as their own chunk. The landing
  page never imports them, and the docs never import Lexical or Yjs except through the live
  inspector, which loads lazily on its page.
- Every code block comes from a real file, imported with `?raw`: example code from
  `src/docs/snippets/*.ts` (type-checked by `pnpm typecheck`, and the ones that make claims
  tested by Vitest), or a declaration cut out of jot's own source by `excerpt()`, linked to
  its exact lines on GitHub. The install command is built from `package.json`.
- Pages for features still in flight are written from their approved spec and checked
  against the merged code before the docs merge.

## Why

Docs for developers rot fastest in their code blocks. A snippet that has to compile, and
an excerpt that has to exist, fail CI when the code moves, instead of misleading a reader.
Keeping the docs in the app keeps one deploy and one design system, and the inspector can
run jot's real editor configuration.

## Consequences

- Prose can still drift from behaviour; only code is checked. Changing a feature means
  rewriting its page in the same PR (D09).
- Pages are TSX, not Markdown: no Markdown pipeline to maintain, at the cost of JSX noise
  when editing prose.
- Renaming a declaration that a page excerpts fails the unit tests until the page names it
  again.
