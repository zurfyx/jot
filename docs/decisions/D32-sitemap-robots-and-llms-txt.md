# D32: A sitemap, robots.txt and llms.txt, built from the route data as static files

Status: `DECIDED`

## Context

With the public pages prerendered (D31), search engines and assistants can read jot's
landing page and docs, but nothing told them which pages exist, and `robots.txt` was a
hand-written file that named no sitemap. Assistants read Markdown best; the docs were only
HTML.

## Decision

- **Built from the route data.** `scripts/prerender.ts` writes, after the pages:
  `robots.txt`, `sitemap.xml` (every public page's canonical URL, from `heads.ts`), a
  Markdown copy of every docs page next to it (`/docs.md`, `/docs/<slug>.md`), `llms.txt`
  (an index: jot's name and summary, then every docs page by group with its Markdown link
  and its one line from `docs/pages.ts`) and `llms-full.txt` (every docs page's Markdown
  in reading order, each under its address). None of it is committed.
- **Markdown from the prerendered HTML.** `scripts/markdown.ts` converts each docs page's
  `<article>` from the HTML the build just rendered: headings, paragraphs, lists, links
  (made absolute), inline code, tables, callouts as quotes, and code blocks fenced with the
  language their `<pre>` names (`data-language`). It drops what only a browser needs:
  buttons, what is hidden from assistive technology, an animation's moving frames. Text
  never reads as Markdown it isn't: `\`, `` ` ``, `*`, `_`, `[`, `]` and `<` are escaped
  anywhere, and a line that would start a heading, a quote, a bullet or a numbered item
  is escaped at its start; code takes a fence longer than any run of backticks in it,
  with a space inside when it starts or ends with one. Where the page separates a label
  from its text by CSS alone (a block title), the source puts a space between them, so
  the Markdown keeps them apart too. It is a small parser for the markup React renders,
  not a general HTML library, so the build gains no dependency.
- **The landing page has no Markdown copy.** It is `llms.txt`'s subject (its name, summary
  and address head the index); its illustrations make no sense as text.
- **Types.** The build writes `_headers` rules for each file it generated, by name:
  `text/markdown`, `text/plain` and `application/xml`, each `charset=utf-8`. A pattern
  would also give an unknown `.md` path's 404 page the Markdown type.
- **robots.txt and the sitemap are static files**, served from the assets like the rest,
  the Worker never involved. `robots.txt` disallows `/n/`, `/api/` and `/new` (a link
  that creates a note) and names `Sitemap: https://jot.rovira.sh/sitemap.xml`; the sitemap
  lists production's URLs.
- **Previews serve the same files.** A Preview (a `*.workers.dev` host, D24) answers
  `robots.txt` and `/sitemap.xml` with production's, and that is harmless: Cloudflare marks
  every Preview response `noindex`, so nothing on a Preview is indexed, and a sitemap
  naming jot.rovira.sh URLs only points crawlers at production. robots.txt does not block
  Previews either: a crawler must fetch a page to see its noindex.

## Why

- One list (the docs' table of contents and the landing page's head) drives the pages,
  their heads, the sitemap and the index, so a new docs page is in all of them by being in
  the list, and a test fails otherwise.
- Converting the pages the build renders keeps the Markdown exactly the docs' content;
  writing it separately would drift.
- Static files keep the Worker out of it: one build serves production and every Preview,
  and nothing about them depends on the host.

## Consequences

- A docs page needs an `<article>` with its title as its `# ` heading, or the build fails.
- New markup in the docs that the converter doesn't know reads as plain text; a test of
  the converter covers each kind it handles.
- A Preview's `robots.txt` names production's sitemap. A Preview on a custom domain
  would not get Cloudflare's noindex (D24); it would need its own rule first.
