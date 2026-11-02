# D33: The app's script at low priority; hashed assets cached for a year

Status: `DECIDED`

## Context

On a phone, a prerendered page (D31) paints from its HTML and its stylesheet. The app's
script (about 91 KB compressed), the Geist font and, on jot.rovira.sh, Cloudflare's
analytics script all load at once and share the bandwidth with the stylesheet, so the first
paint waits on bytes it doesn't need. And every asset was served with Workers Static
Assets' default `public, max-age=0, must-revalidate`: a returning visitor asked again for
files whose names change with their content.

## Decision

- **The app's script loads at low priority.** `scripts/prerender.ts` adds
  `fetchpriority="low"` to the entry `<script type="module">` of every page it writes, the
  note's shell included (Vite writes that tag itself, so the attribute can't go in
  `index.html`), and to a docs page's `modulepreload` links. The HTML, the stylesheet and
  the font get the bandwidth first; the page hydrates a little later, behind the same gate
  (`data-hydrated`, D31), and nothing a person sees changes. The build fails unless the
  shell has exactly one entry script.
- **Content-hashed assets are cached for a year.** The build writes a `_headers` rule for
  every file in `assets/` whose name carries Vite's hash (`<name>-<8 characters>.<ext>`):
  `Cache-Control: public, max-age=31536000, immutable`. Everything else keeps the default
  and is revalidated on every use: the pages, the shell, `robots.txt`, the sitemap, the
  `llms` files and the Markdown copies (D32), the link-preview images and the favicon.
- **File by file, not a pattern.** Workers Static Assets applies `_headers` to the 404 page
  it serves for a missing path, so an `/assets/*` rule would cache a missing asset's 404
  for a year. The build names each file instead, and fails if `_headers` would pass
  Cloudflare's limit of 100 rules.

## Why

- The critical path to the first paint is HTML, then CSS; the script only hydrates what is
  already painted, so it can wait.
- A hashed name is a promise that the content never changes under it; caching it forever
  is safe, and a new build brings new names.

## Consequences

- Hydration starts a little later on a slow network; the tests already wait for it.
- A new asset in `assets/` without a hash is revalidated, not cached; the production tests
  fail if the build ever writes one.
- About 25 assets and 15 typed files leave room under the 100-rule limit; a build that
  outgrows it fails and needs a different approach (a Worker rule, or fewer files).
