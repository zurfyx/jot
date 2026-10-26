# D17: Notes stay out of search engines

Status: `DECIDED`

## Decision

- The Worker adds `X-Robots-Tag: noindex, nofollow` to every response for `/n/*` and
  `/api/*`, including 400s, 404s, 426s and the 101 WebSocket upgrade. `wrangler.jsonc`
  already runs the Worker first for both paths, so no response there skips it.
- `public/robots.txt` disallows `/n/` and `/api/` for every user agent.
- The landing page carries neither and stays indexable.

## Why

A note's link is its key (D02). Links leak into public chats, issues and pages; a crawler
that follows one should neither index the note nor follow the links people write in it.

## Consequences

- Well-behaved crawlers never fetch note pages. A search engine that learns a note URL
  from elsewhere may still list the bare URL without its content, because `robots.txt`
  keeps it from fetching the page and seeing the header; the header covers crawlers that
  ignore `robots.txt` or fetch the page anyway.
- Neither is access control. The link is still the only thing protecting a note.
