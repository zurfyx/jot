# D31: Prerender the public pages with jot's own router; real 404s; no framework

Status: `DECIDED`

## Context

jot was a single-page app: every page arrived as an empty `<div id="root">`, and unknown
paths fell back to `index.html` with a 200. Search engines and link previews saw one
title and one description for the whole site, no page text before the script ran, and no
real 404s. The landing page and the docs are public and change only with a deploy; a note
is private (D17) and is all script.

## Decision

- **Prerender the landing page and every docs page at build time**, and nothing else.
  `pnpm build` runs `vite build`, then `scripts/prerender.ts`: a server build of
  `src/client/prerender.tsx` (Vite's SSR build, with the same StyleX plugin, so the same
  class names), React's `prerender` from `react-dom/static` in Node, and the built
  `index.html` as the template. It writes `index.html`, `docs/index.html`,
  `docs/<slug>/index.html` (from the docs' table of contents) and `404.html`, and keeps
  the empty shell as `n/shell.html`. The client entry hydrates a root that has children
  and renders into an empty one.
- **jot's own router stays** (`src/client/router.ts`, History API only). The prerender
  sets the path it renders; the browser reads its own address.
- **A note stays client-only**: the Worker serves the empty shell for `/n/<id>`, and for
  `/new` and `/new?example`, which now run the Worker first. The shell sits under `/n/`,
  where asking for it directly is a malformed link (400).
- **A head per page**, from one list (`src/client/heads.ts`: the landing page's head in
  `site.ts`, one per docs page from `docs/pages.ts`): the title, the description, the
  canonical URL on jot.rovira.sh, Open Graph and Twitter tags, and JSON-LD (`WebSite` on
  the landing page, `TechArticle` on a docs page). The pages set their own title from it
  when reached in the app.
- **A link-preview card per page**, 1200×630, drawn by `pnpm og-images`
  (`scripts/og-images.ts`, with the Playwright Chromium the tests already use) from the
  same list, jot's tokens and Geist, and committed under `public/og/`. Each PNG carries
  the hash of the card it was drawn from; a unit test fails when a card is missing or
  stale. Nothing draws images at build or deploy time.
- **Real 404s.** Workers Static Assets uses `not_found_handling: "404-page"` and
  `html_handling: "drop-trailing-slash"`: a path no file answers gets `404.html` with a
  404, an unknown docs slug included, and `/docs/blame/` redirects to `/docs/blame`. A
  malformed note link keeps its 400. In the app, an unknown path or docs page shows the
  same 404 page.
- **The first render is the browser's first render.** What depends on the browser runs in
  effects (storage, media queries, locks, sockets, models, time, randomness); animations
  render their opening frame and start after load. What depends on the device goes
  through CSS: the landing page's illustrations render their moving frames and their still
  end frame side by side, and CSS shows the still one under reduced motion, so it is there
  from the first paint rather than after hydration; the landing page's and the docs' dark
  token sets moved from `createTheme`
  classes to `globals.css`, keyed to `data-theme` like the app's own (D28); the start
  shortcut's label is both labels, and `index.html`'s pre-paint script marks Apple
  platforms for CSS to pick one. Without scripts, the prerendered head's `<noscript>`
  style gives the dark sets to a system in dark mode.
- **Primary actions are links.** Start a new note and See the example are `<a href>` to
  `/new` and `/new?example`, so they work before hydration and without scripts; a plain
  click still opens the note in place with its view transition. Every link to `/new` is
  `rel="nofollow"`: following one creates a note.
- The main Geist font is preloaded on prerendered pages.

## Why no framework

TanStack Start was built and measured on 2026-10-31 (prerender, selective SSR, a custom
server entry for the Durable Object): it worked, but the landing page's first-load JS grew
from 81.3 to 120.7 KB gzipped (+39 KB), almost all of it the framework's own runtime
(router-core, its serializer, React Router), on every page, for routing jot already does
in about 80 lines. React Router's framework mode and Next.js (through OpenNext or vinext)
bring the same kind of runtime and a routing model of their own; Astro ships little script,
but would move the public pages into a second kind of page with its own build, for a site
with three public routes. A prerender script costs nothing at runtime: the landing page grows by
about half a kilobyte (the 404 page and the hydrate path).

## Cost (measured with `pnpm build`, gzipped, against `main`)

|                              | `main`          | Prerendered     |
| ---------------------------- | --------------- | --------------- |
| Landing first load, JS + CSS | 81.3 + 9.3 KB   | 81.7 + 9.4 KB   |
| Note page, JS + CSS          | 355.0 + 12.1 KB | 355.5 + 12.2 KB |
| Docs, JS + CSS               | 114.8 + 10.4 KB | 115.4 + 10.4 KB |

The prerendered HTML is larger (about 30 KB for the landing page, before compression), and
the build takes a second longer for the server build and the render.

## Consequences

- A component the landing page or the docs render must render the same on the server and
  in the browser's first render: tests fail on any hydration warning, and on any
  difference between the page with scripts off and the page right after it hydrates.
- A new public page gets its head in `heads.ts`, a card from `pnpm og-images`, and its path
  prerendered from the same list.
- A click on a button before hydration does nothing (a link still navigates); the tests
  wait for `data-hydrated` on `<html>`, which App sets once it runs.
- The dev server prerenders nothing: `pnpm dev` is the single-page app it was. The
  production build's tests run against `wrangler dev` on the built Worker.
