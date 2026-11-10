# D35: Code highlighting with Prism, fetched with a note's first code block

Status: `PROPOSED`

## Context

Code blocks (`@lexical/code-core`) were plain monospace. jot is the playground for
`@lexical/y`, and a highlighter is one of the transforms that rewrite a document's nodes as
people type, so it belongs here. Lexical has two: `@lexical/code-shiki` and
`@lexical/code-prism`. An extension set is fixed when the editor is built, but both
packages export `registerCodeHighlighting(editor)`, which can be called on a built editor,
so either can be fetched with a dynamic `import()` and registered later. Most notes hold no
code, and they should not pay for a highlighter.

Measured on this build (gzipped):

- **Shiki**: its core and JavaScript regex engine, about 66 KB, then a grammar per language
  (TypeScript about 16 KB, Python 9 KB, C++ 58 KB) and a theme. Its grammars do load per
  language, but `@lexical/code-shiki` imports the whole `shiki/langs` and `shiki/themes`
  lists, so the build emits a chunk for every bundled grammar and theme, over 300 files,
  past the 100 `_headers` rules D33 writes one per hashed file. Its colours are inline
  styles from the theme the block stores (its background too), so a note's code would look
  the same in light and dark, in colours outside jot's tokens.
- **Prism**: one chunk with Prism and the 17 grammars `@lexical/code-prism` loads, about
  19 KB: less than Shiki's core alone. It loads no grammar on demand, but all of them
  together cost about one Shiki grammar. Each token is stored as a type name
  (`keyword`, `string`), which jot's theme maps to classes, so the colours are tokens and
  follow the theme.

## Decision

- **Prism**, through `@lexical/code-prism`, pinned to the same Lexical build as the rest
  (D04).
- **Fetched with the first code block.** `CodeHighlightExtension` (`editor/code/`) watches
  each commit's changed nodes and, the first time one is a code block (the note opened with
  one, a collaborator added one, or someone typed ` ``` `), imports
  `editor/code/highlight.ts`, the highlighter's own chunk, and registers it. A failed fetch
  (offline) is tried again with the next change to a code block. A note without code never
  fetches it.
- **Only while the editor is editable**, since the highlighter writes: a read-only note
  shows the tokens its writers stored, and fetches nothing.
- **The tokens are part of the note.** Whoever edits a block writes its tokens with the
  edit, and every client shows what is stored. `@lexical/y` does not write the pass Lexical
  makes over the existing nodes when a transform registers (no one edited them), so a
  block written without the highlighter, or typed before it arrived, shows as stored
  until someone edits it again; the next keystroke in the block highlights all of it.
- **Colours:** five `--syntax-*` tokens and the text's own colour, comments and punctuation
  muted (`docs/design.md`).
- **Language picker** on the block holding the caret, the languages `@lexical/code-prism`
  lists (a copy, so the picker needs nothing from the lazy chunk). A block with no language
  is highlighted as JavaScript, the highlighter's default, which it then stores.
- **No schema version change** (D29): `CodeHighlightNode` is registered by
  `@lexical/code-core`'s `CodeExtension`, which jot has had since its first schema, and a
  block's language was already stored. A jot without the highlighter reads and edits
  highlighted blocks; its plain text is re-tokenized by the next edit from a jot with it.

## Why

- Size: a note without code pays only the small static part (the extension, the picker,
  the token classes) and the few Lexical functions the lazy chunk shares with the editor,
  which must be one copy: `@lexical/code-core` and `lexical` each ship as one module, so
  the indentation and token helpers the highlighter uses from them sit in the editor's
  chunk. Measured on the note page's initial script: 411.9 KiB gzipped before, 418.8 KiB
  after (+6.9 KiB, 1.4 KiB of it jot's own code); the highlighter's chunk is 18.9 KiB.
- Prism's classes keep every colour a token and follow light and dark, which inline theme
  styles can't; its single chunk keeps the build's file count where D33 needs it.

## Consequences

- Seventeen languages. A block in another language (` ```ruby `) keeps its name and
  stays plain.
- If Lexical splits `@lexical/code-core`'s highlighter helpers into an entry of their own,
  they would move into the lazy chunk and the static cost would drop by about 2.5 KB.
- Revisit Shiki if `@lexical/code-shiki` lets an app choose its grammars and themes, and
  colour through classes or CSS variables.
