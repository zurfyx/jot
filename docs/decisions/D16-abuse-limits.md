# D16: Abuse limits: rate limits and connection caps

Status: `DEFERRED`

## Context

The relay accepts any well-formed message from anyone with a link. There are no rate
limits per connection or IP, no cap on connections per note, and no limit on how many
notes one client creates.

## Revisit when

Traffic or abuse shows up. Cloudflare's rate limiting rules on `/api/n/*` are the first
step, before anything in code.
