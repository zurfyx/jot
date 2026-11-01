# D32: A sitemap, robots.txt and llms.txt from the route data; Previews name no sitemap

Status: `DECIDED`

## Context

With the public pages prerendered (D31), search engines and assistants can read jot's
landing page and docs, but nothing told them which pages exist, and `robots.txt` was a
hand-written file that named no sitemap. Assistants read Markdown best; the docs were only
HTML.

## Decision

- **Built from the route data.** `scripts/prerender.ts` writes, after the pages:
  `sitemap.xml` (every public page's canonical URL, from `heads.ts`), a Markdown copy of
  every docs page next to it (`/docs.md`, `/docs/<slug>.md`), `llms.txt` (an index:
  jot's name and summary, then every docs page by group with its Markdown link and its one
  line from `docs/pages.ts`) and `llms-full.txt` (every docs page's Markdown in reading
  order, each under its address). None of it is committed.
- **Markdown from the prerendered HTML.** `scripts/markdown.ts` converts each docs page's
  `<article>` from the HTML the build just rendered: headings, paragraphs, lists, links
  (made absolute), inline code, tables, callouts as quotes, and code blocks fenced with the
  language their `<pre>` names (`data-language`). It drops what only a browser needs:
  buttons, what is hidden from assistive technology, an animation's moving frames. It is
  a small parser for the markup React renders, not a general HTML library, so the build
  gains no dependency.
- **The landing page has no Markdown copy.** It is `llms.txt`'s subject (its name, summary
  and address head the index); its illustrations make no sense as text.
- **Types.** The build writes `_headers` rules for each file it generated, by name:
  `text/markdown; charset=utf-8` and `text/plain; charset=utf-8`. A pattern would also
  give an unknown `.md` path's 404 page the Markdown type.
- **robots.txt and the sitemap come from the Worker**, which runs first for both and decides
  by host. Everywhere: `Disallow: /n/`, `/api/` and `/new` (a link that creates a note). In
  production, `Sitemap: https://jot.rovira.sh/sitemap.xml` too, and the built sitemap. On a
  Preview (a `*.workers.dev` host, D24): the same rules, no `Sitemap:` line, and a 404 for
  `/sitemap.xml`, since the built sitemap lists production's pages. Previews stay noindex
  through Cloudflare's header, so robots.txt does not block them: a crawler must fetch a
  page to see its noindex.

## Why

- One list (the docs' table of contents and the landing page's head) drives the pages,
  their heads, the sitemap and the index, so a new docs page is in all of them by being in
  the list, and a test fails otherwise.
- Converting the pages the build renders keeps the Markdown exactly the docs' content;
  writing it separately would drift.
- Deciding by host keeps one build for production and every Preview.

## Consequences

- A docs page needs an `<article>` with its title as its `# ` heading, or the build fails.
- New markup in the docs that the converter doesn't know reads as plain text; a test of
  the converter covers each kind it handles.
- `pnpm dev` and the local production build (any host but workers.dev) answer as
  production.
