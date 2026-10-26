# D15: No public note

Status: `DECIDED`

## Decision

There is no public note: no note with a fixed id, and no shared note linked from the
landing page. `public` is not a valid note id, so `/n/public` gets the same 400 as any
malformed id (D02).

## Why

- **Abuse on a personal domain.** jot runs on jot.rovira.sh. A note anyone can find and
  edit, with no moderation, would carry whatever anyone writes under the owner's name.
- **Anyone can fill it.** A single shared note can be pushed to the 2 MB cap (D05) by one
  person, after which it is read only for everyone.

## Consequences

- The landing page offers two ways in: Start a new note, or join with a link or code.
- To try jot with someone, start a note and share its link.
- Every note expires on the same 90-day rule (D06).
