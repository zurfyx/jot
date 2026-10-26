# D06: 90-day expiry without visits; the public note never expires

Status: `DECIDED`

## Decision

- Every WebSocket connection to a note resets its Durable Object alarm to now + 90 days.
- When the alarm fires and nobody is connected, the object deletes all its storage. If
  someone is connected, that counts as a visit and the alarm is rescheduled.
- The public note (`public`) never has an alarm; a connection to it clears any alarm.

## Consequences

- No sweeper jobs, no index of notes: each note keeps its own clock.
- A note visited once a quarter lives forever. That is intended.
- The landing page says notes are deleted after 90 days without visits.
