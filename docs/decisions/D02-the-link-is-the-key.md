# D02: The link is the key; 128-bit ids; public note id

Status: `DECIDED`

## Decision

- A note id is 128 random bits from `crypto.getRandomValues`, written as 22 base64url
  characters. Because 128 bits end two bits into the 22nd character, a valid id's last
  character is one of `A`, `Q`, `g`, `w`; validation is that exact pattern.
- Possession of the link is the only access control: no accounts, no listing, no
  read-only links. Anyone with it can read and edit.
- One note has a fixed id, `public`, linked from the landing page.
- The Worker validates ids on `/n/:id` and `/api/n/:id/ws` and answers 400 otherwise, so
  no Durable Object is created for junk.

## Consequences

- Ids cannot be guessed (2^128), but links leak through chat logs and screenshots. The
  product says so: don't paste anything private.
- The public note is shared by everyone; see D15 for how it is kept usable.
- Moving to accounts or per-note permissions later is a new model, not a tweak.
