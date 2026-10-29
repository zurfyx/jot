# D25: Notes in an older `@lexical/y` layout stay read only; no conversion

Status: `DECIDED`

## Context

`@lexical/y`'s stored layout changed while it was a pull request, before it froze layout 1
and merged into meta/lexical's `main`. Notes written by builds of jot from before the
layout froze record their layout as `lexical-y` = `1` or `2` on the root, store some values
differently, and can hold move records (`↷`). The binding records its layout as one
`lexical-y:<n>` = `true` attribute per version (`lexical-y:1` for every note jot writes
today), and opens a root with content but no such record read only, showing what it can
read (`UNSUPPORTED_LAYOUT_WARNING`, reason `missing`). The binding's own layout 2 (member
entries of set-valued NodeState, recorded as `lexical-y:2` = `true`) is unrelated to those
notes' `lexical-y` = `2`.

jot holds one copy of Lexical (D04), so it can't run the older binding beside the new one
to convert a note, and the older layouts have no reader in the binding jot pins.

## Decision

- A note written in an older layout opens read only, with the same banner as a note in a
  newer layout. jot converts nothing and writes nothing to it.
- Blame still paints such a note, and still leaves lines a move record covers unpainted
  (`moves.ts`), so it never names the wrong person.
- New notes start in the binding's current layout.

## Why

- Read only can't corrupt a note; a converter in a playground would be a second binding to
  keep correct for a layout nobody writes any more.
- Notes are public playground notes kept 90 days without visits (D06): anyone who needs
  the text can still read and copy it.

## Consequences

- Notes from before the layout froze can't be edited again; their readers start a new note.
- When the binding changes layout again, the same rule applies: older notes open read only
  unless the binding itself reads them.
