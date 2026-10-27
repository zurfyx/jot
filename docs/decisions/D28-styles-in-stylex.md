# D28: Styles in StyleX, each page's CSS in its own chunk; a small global stylesheet

Status: `DECIDED`

## Context

jot was styled with three plain stylesheets (`styles.css`, `landing/landing.css`,
`docs/docs.css`, 3,970 lines) of class rules, with tokens as CSS custom properties. An
experiment (PR #25, closed) ported it to StyleX and Astryx; Gerard kept StyleX and dropped
Astryx. The visual and interaction suite (D27) is the gate: the port has to be
pixel-identical and behave the same.

## Decision

- **StyleX for every style.** `stylex.create` beside each component (about 3,700 lines in
  42 files), `stylex.keyframes` for motion, `stylex.viewTransitionClass` for opening a note,
  `stylex.when.*` with markers for hover, focus and sibling rules, and StyleX classes in
  Lexical's theme. jot's markup and behaviour are unchanged.
- **Tokens are `defineVars`** in `src/client/theme/tokens.stylex.ts`, with literal names
  (`--bg`), so plain CSS and inline styles read them too; the dark set and the landing page's
  and docs' scopes are `createTheme` classes in `theme/themes.ts`.
- **Each page's CSS in its own chunk.** `scripts/vite-stylex.ts` runs StyleX's Babel plugin
  on each module and has the module import its own rules as CSS, so Vite's CSS code
  splitting ships them with the module's chunk: the landing page loads only its own styles,
  and the note page's and the docs' come with their lazy chunks. StyleX's own Vite plugin
  (`@stylexjs/unplugin`) writes one stylesheet for the whole app, so it isn't used. To keep
  the cascade right across stylesheets, every module's rules are processed with a
  placeholder at each priority level, so a level has the same specificity in every
  stylesheet and the order they load in doesn't matter.
- **A small global stylesheet** (`src/client/globals.css`, 128 lines, a one-line reason per
  rule) for what StyleX can't express: `color-scheme` from `data-theme`; the element reset
  and browser defaults, in a `reset` layer so every StyleX class beats them (box-sizing, the
  scrollbars, `::selection`, `:focus-visible`, links, heading margins, Geist Mono for code,
  bare buttons); `<body>`; the reduced-motion switch; `::highlight(jot-ai-target)`; the
  caret's scroll padding while a note shows the dock (`:root:has(...)`); and a table
  selection's `::selection`. `@font-face` comes from the `@fontsource` packages. The docs'
  inspector keeps one rule in `docs/docs.css` for the classless `<code>` Lexical writes.

## Why

- One typed styling system: styles live with the component that uses them, a token is an
  import, unused styles never ship, and a misspelt property fails the build.
- With per-chunk CSS the landing page's CSS is smaller than before (8.8 KB gzipped against
  9.6 KB), and the note page's and docs' styles load only on those pages.

## Cost (measured with `pnpm build`, gzipped, against `main`)

|                              | `main`            | StyleX                  |
| ---------------------------- | ----------------- | ----------------------- |
| Landing first load, JS + CSS | 74.4 + 9.6 KB     | 81.3 + 8.8 KB (+6.1 KB) |
| Note page, JS + CSS          | 320.5 + 9.6 KB    | 333.4 + 14.6 KB         |
| Docs chunk, JS + CSS         | 28.5 + 2.2 KB     | 31.5 + 2.8 KB           |
| Total CSS (raw)              | 11.9 KB (51.9 KB) | 18.7 KB (90.7 KB)       |
| Build time (median of 3)     | 1.2 s             | 2.3 s                   |

- The JS grows because each element carries its atomic class names instead of one
  semantic class; StyleX's minified keys and inlined conditional merges are already on, and
  inlining more conditions saved nothing measurable.
- A page's CSS is spread over a few files that repeat shared atomic rules, so the note
  page loads more CSS than before (the landing page's entry stylesheet, Lexical's theme and
  its own), and the CSS is larger raw than hand-written rules.
- The build runs Babel over every styled module.

## Consequences

- New UI is written in StyleX; a raw colour outside the token files, or a rule in
  `globals.css` that StyleX could express, is a review comment.
- A selector a test needs is a test id or a data attribute, not a style class.
- StyleX upgrades go through `scripts/vite-stylex.ts` and its tests, and the visual suite.
