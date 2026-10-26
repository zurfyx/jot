# D26: Images in notes, stored in R2 and served by the Worker

Status: `DECIDED`

## Context

People want to paste a screenshot into a note. A note is one SQLite row capped at 2 MB of
Yjs state (D05): image bytes in the document would fill it with one photo and travel to
every peer on every sync. Cloudflare R2 stores files next to the Worker, and its free tier
(10 GB, no egress fees) is far more than a playground needs.

## Decision

- **Bytes never go in the note.** An image is a Lexical `DecoratorNode` (`jot-image`)
  whose NodeState holds the image's path on jot (`/api/n/<note id>/images/<key>`), its alt
  text and its pixel size; `@lexical/y` stores it as a node of its own (`describeStorage`
  says `nested`). The file lives in R2 at `<note id>/<key>`.
- **Upload through the Worker.** `POST /api/n/<id>/images` takes the raw file with its
  `Content-Type`; the Worker hands it to the note's Durable Object, which checks it,
  stores it and answers `201 { key, src }`. `GET /api/n/<id>/images/<key>` streams it from
  R2 with its type, `Cache-Control: public, max-age=31536000, immutable`,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="image.<ext>"`,
  `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin` and the usual `noindex, nofollow` (D17). The
  bucket is never public.
- **Checked on the server.** Only PNG, JPEG, WebP and GIF, told by their magic bytes; the
  declared type must agree (a cross-site form can't send an image type, so other sites
  can't upload through a visitor's browser). At most 1.5 MB per file. Per note, at most 20
  images and 10 MB in all, counted by the note's Durable Object in an `images` table. Keys
  are 128 random bits made by the server, never from the file name.
- **Refused when the note can't take it.** The object refuses an upload when the note's
  text is at its cap (no room for even the image node: the note is full and read only for
  everyone, D05) and when its image caps are reached. The other read-only state, a note
  in a layout this build's binding can't write, is the binding's judgment in the browser:
  the relay doesn't read Lexical's layout (D03), so the page enforces it, by disabling
  insertion whenever the editor isn't editable. A client that ignored it could only store
  files the caps already bound.
- **Shrunk in the browser.** Before upload the page decodes the image, scales it to 1600 px
  on the long side and encodes WebP (JPEG where a browser can't encode WebP), lowering the
  quality until it fits; a small original that already fits is kept when it is smaller.
  A GIF under 1.5 MB is kept as it is, so its animation survives; an animated GIF over it
  is refused. Cloudflare's image transformations are never used.
- **Only this note's images are shown.** Every value of the node is parsed as untrusted
  input: `src` keeps only a jot image path (any URL, `data:` or other path becomes empty),
  and the page renders an `<img>` only when that path names its own note. Anything else
  shows "Image not shown: it isn't stored with this note." and requests nothing, so a peer
  can't make others' browsers load an arbitrary URL. HTML pasted with `<img>` tags brings
  no images.
- **Uploads need the network.** While offline or in Work offline, Aa → Image is disabled
  and a paste or drop says why; offline edits still wait in memory (D13).
- **Cleanup at expiry.** When the note's alarm deletes it (D06), the object first deletes
  every R2 object under `<note id>/` (listed by prefix), inside `blockConcurrencyWhile` so
  no upload lands in between, then its storage. If R2 fails, the alarm throws and is
  retried with the rows still there. An image removed from the text stays in R2 until the
  note expires, and still counts against the caps.
- **Buckets.** Production binds `jot-images` as `IMAGES`. Previews bind
  `jot-images-preview` in the `previews` block, so a Preview never reads or writes
  production's images (D24).

## Why

- R2 keeps the document small and the relay unchanged: the image node is a few hundred
  bytes of Yjs, so syncing, blame and the 2 MB cap work as before.
- Upload through the Worker keeps one origin, one access model (the link) and one place
  to count. Presigned direct uploads would need S3 credentials and could not enforce the
  per-note caps before the bytes land.
- Shrinking in the browser keeps uploads quick on phones and keeps jot inside R2's free
  operations, with no paid transformations.
- A placeholder node in the document (its upload id and start time) shows collaborators
  that an image is coming. The uploading tab shows its preview and progress; others see
  "Someone is uploading an image…", and after two minutes without a path, "This image's
  upload didn't finish."

## Consequences

- **Abuse.** Anyone with a note link can host images on jot.rovira.sh. The bounds: 20
  images and 10 MB per note, deletion 90 days after the last visit, `same-origin`
  resource policy (other sites can't embed them; a direct link still opens one), noindex,
  and no listing. Creating many notes multiplies the caps; rate limits stay deferred
  (D16), with Cloudflare's rate limiting rules on `/api/n/*/images` as the first step.
- Deleting an image from the text does not free its place under the caps until the note
  expires. Per-image deletion would need to know no peer, undo stack or offline copy still
  points at the file; expiry needs none of that.
- A tab that closes mid-upload leaves its placeholder in the note, shown as unfinished;
  anyone can select it and delete it.
- Images don't work offline and are not covered by Work offline's merge demo.
- Ask AI refuses a target that holds an image: Markdown can't carry the node, so a rewrite
  would drop it.
