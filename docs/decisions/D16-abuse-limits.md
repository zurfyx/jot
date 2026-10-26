# D16: Abuse limits: rate limits and connection caps

Status: `DEFERRED`

## Context

The relay accepts any well-formed message from anyone with a link, and any note accepts
image uploads up to its caps (20 images, 10 MB, D26). There are no rate limits per
connection or IP, no cap on connections per note, and no limit on how many notes one
client creates, so the per-note caps multiply with the notes.

## Revisit when

Traffic or abuse shows up, or R2 storage grows past what a playground should hold.
Cloudflare's rate limiting rules on `/api/n/*` (uploads at `/api/n/*/images` first) are
the first step, before anything in code.
