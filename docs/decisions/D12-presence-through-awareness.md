# D12: Presence: names, colours and carets through awareness

Status: `DECIDED`

## Decision

- Each client's awareness state carries `user` (a name and a colour index, kept in
  localStorage) and `cursor`, its selection as Yjs relative positions from
  `YBinding#getCursor()`.
- Peers resolve cursors with `YBinding#$resolveCursor()` and draw carets and selections
  over the page with Lexical's `createDOMRange` and `createRectsFromDOMRange`.
- Awareness states are untrusted: names are clipped, colours are indexes into theme
  tokens, cursors that fail to resolve are skipped.
- The count in "Synced · N here" is the number of awareness states.
