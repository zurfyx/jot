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
  (`--bg`), so plain CSS and inline styles read them too. The dark values sit in
  `globals.css` under `:root[data-theme='dark']`: `index.html` sets `data-theme` before the
  first paint, and only CSS (not a class added by the app's script) can apply before it. A
  unit test keeps the two lists of tokens the same. The landing page's and the docs' scopes
  are `createTheme` classes in `theme/themes.ts`.
- **Each page's CSS in its own chunk.** `scripts/vite-stylex.ts` runs StyleX's Babel plugin
  (on Babel 7, its own dependency) on each module, and the module imports its own rules as
  CSS, so Vite's CSS code splitting ships them with the module's chunk: the landing page
  loads only its own styles, and the note page's and the docs' come with their lazy chunks.
  StyleX's own Vite plugin (`@stylexjs/unplugin`) writes one stylesheet for the whole app,
  so it isn't used. `@stylexjs/*` are pinned exactly: the plugin reads StyleX's rule data.
- **The cascade across stylesheets.** StyleX orders atomic rules by priority, by position
  in one stylesheet. Here every priority is a cascade layer (`stylex.p<priority>`), and the
  first stylesheet every page loads declares them all in priority order
  (`virtual:stylex-order.css`, imported first by `main.tsx`), so a rule wins by its
  priority whichever stylesheet holds it and whenever it loads. The plugin compiles all of
  `src` when it starts, so the order is complete before the first page. It fails the build
  on a priority it can't name or order.
- **Each rule ships once.** The build places every rule in one stylesheet: the entry's if an
  entry module uses it or two lazy stylesheets would share it, otherwise its one lazy
  stylesheet. Within one priority, order still comes from position, so rules of one
  priority and one property under different conditions (two media queries, say) are kept
  where their order can't depend on which page loaded first: in one lazy stylesheet, or in
  the entry when they span more. Rules of one priority, property and condition never meet
  on an element (`stylex.props` keeps one class per property and condition). This placement
  happens only in the build: the dev server serves each module's rules as its own
  stylesheet, so there two same-priority rules of one property from different modules
  follow the order their stylesheets arrived in. The production tests run on the build.
- **A small global stylesheet** (`src/client/globals.css`, a one-line reason per rule) for
  what StyleX can't express: `color-scheme` and the dark token values from `data-theme`;
  element defaults (type selectors) in a `reset` layer below every StyleX layer
  (box-sizing, the scrollbars, `::selection`, `:focus-visible`, links, heading margins,
  Geist Mono for code, bare buttons); `<body>`; the reduced-motion switch;
  `::highlight(jot-ai-target)`; and a table selection's `::selection`. `@font-face` comes
  from the `@fontsource` packages. The docs' inspector keeps one rule in `docs/docs.css` for
  the classless `<code>` Lexical writes. The note page's scroll padding for the dock is a
  StyleX class it puts on `<html>` while it shows the dock.
- **Tests.** Unit tests cover the plugin (layers, placement, the order, the priority guard);
  a production project builds the app and checks where every rule went, that the theme
  paints before any script, that a late lazy stylesheet is in before its page shows, and
  that a page looks the same reached from any other.

## Why

- One typed styling system: styles live with the component that uses them, a token is an
  import, unused styles never ship, and a misspelt property fails the build.
- With per-chunk CSS the landing page's CSS is smaller than before (8.8 KB gzipped against
  9.6 KB), and the note page's and docs' styles load only on those pages.

## Cost (measured with `pnpm build`, gzipped, against `main`)

|                              | `main`            | StyleX                  |
| ---------------------------- | ----------------- | ----------------------- |
| Landing first load, JS + CSS | 74.4 + 9.6 KB     | 81.3 + 9.3 KB (+6.6 KB) |
| Note page, JS + CSS          | 320.5 + 9.6 KB    | 333.5 + 12.1 KB         |
| Docs chunk, JS + CSS         | 28.5 + 2.2 KB     | 31.5 + 1.0 KB           |
| Total CSS (raw)              | 11.9 KB (51.9 KB) | 13.6 KB (42.4 KB)       |
| Build time (median of 5)     | 1.3 s             | 2.8 s                   |

- The JS grows because each element carries its atomic class names instead of one
  semantic class; StyleX's minified keys and inlined conditional merges are already on, and
  inlining more conditions saved nothing measurable.
- The note page loads more CSS than before: the rules the landing page shares with it are
  in the entry stylesheet, and its own come on top.
- The build runs Babel over every styled module, once more at the start for the layer order.

## Consequences

- New UI is written in StyleX; a raw colour outside the token files, or a rule in
  `globals.css` that StyleX could express, is a review comment.
- A selector a test needs is a test id or a data attribute, not a style class.
- StyleX upgrades go through `scripts/vite-stylex.ts` and its tests, and the visual suite.
