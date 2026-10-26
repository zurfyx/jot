# D06: 90-day expiry without visits

Status: `DECIDED`

## Decision

- Every WebSocket connection to a note resets its Durable Object alarm to now + 90 days.
- An image upload counts as a visit too (D26).
- When the alarm fires and nobody is connected, the object deletes the note's images from
  R2 and then all its storage. If someone is connected, that counts as a visit and the
  alarm is rescheduled.
- Every note expires this way; there are no exceptions.

## Consequences

- No sweeper jobs, no index of notes: each note keeps its own clock.
- A note visited once a quarter lives forever. That is intended.
- The landing page says notes are deleted after 90 days without visits.
