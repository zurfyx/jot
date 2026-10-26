# D14: The editor is built with the extension API, without `@lexical/react`

Status: `DECIDED`

## Decision

The note editor is built with `buildEditorFromExtensions` and mounted on a
`contenteditable` element React renders. React draws the chrome, and the editor's decorator
nodes (images, D26) through portals into the elements Lexical creates for them, as
`@lexical/react` would. jot does not depend on `@lexical/react`.

## Why

- `@lexical/react` depends on `@lexical/yjs`, which peers on Yjs 13: a second Yjs in the
  tree for nothing.
- One editor per note session, created and disposed with the session, avoids Strict Mode
  building a second binding on the same document.
