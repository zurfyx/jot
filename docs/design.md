# Design

The editor follows Gerard's product UI rules: a white canvas, theme tokens only, one accent,
few boxes, motion only when state changes, and text lines near 70 characters. It is
direction A ("Pure page") of the design mocks. The landing page is a public playground page,
so it is allowed more colour and motion: "the fan" hero, Clean in light and Night in dark,
and card-free sections below it (D07).

## Tokens

Every colour is a CSS custom property in `src/client/styles.css`, defined twice: light and
dark. `<html data-theme>` picks the set; an inline script in `index.html` sets it before
the first paint from the stored choice or `prefers-color-scheme`. ⌘K → Toggle theme flips
and remembers it.

| Token                        | Use                                                       |
| ---------------------------- | --------------------------------------------------------- |
| `--bg`                       | the page, edge to edge                                    |
| `--ink`, `--body`, `--muted` | text; muted stays above 5:1 on the page                   |
| `--rule`, `--rule-strong`    | hairlines, borders, checkbox outlines                     |
| `--hover`, `--select`        | hover and selected rows, inline code, text selection      |
| `--accent`                   | the one accent: links, focus, checked boxes, the caret    |
| `--btn`, `--btn-ink`         | the primary button and the selection toolbar              |
| `--ok`, `--warn`, `--bad`    | status only, always beside a word                         |
| `--peer-0` … `--peer-7`      | collaborators' identity colours, with `--peer-ink` labels |

The landing page scopes a second set under `.landing`. In dark it re-points the base tokens
to the Night treatment (a deep navy `--landing-bg`, a brighter glow), so its styles read the
same names.

| Token                                 | Use                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| `--landing-bg`                        | the landing page and the body behind it              |
| `--you`, `--ana`, `--ai`              | the example people: green, orange and violet (peers) |
| `--card`, `--card-rule`               | the fan's notes and the mini windows                 |
| `--card-highlight`, `--card-shadow-*` | their top highlight and layered shadows              |
| `--button-shadow`                     | the primary button's drop shadow                     |
| `--glow-opacity`                      | the glow behind the fan (0.5 Clean, 0.75 Night)      |
| `--code-bg`, `--code-ink`, `--code-*` | the dark code block and its keywords and strings     |

## Type

Geist (`@fontsource-variable/geist`) for everything; Geist Mono only for codes and ids
(inline code, the note code in "Opens note k3Jd9x…"). Sentence case, short labels.

## Editor page

- The window is the document: a centred 680px column, 18px text, so lines stay near 70
  characters.
- The note's first line is its title (styled large, and shown in `document.title`). There
  is no title field.
- Chrome: a status pill and Share, floating top right on the page colour. The pill reads
  "Connecting…", "Synced · N here", "Offline · will sync when you reconnect" or "Read
  only", with a dot whose colour repeats the word.
- A new note shows the placeholder "Untitled" and "Start writing. Anyone with this link can
  edit."
- A selection toolbar (B, I, Link, Code, H) appears only over a non-empty selection. ⌘K
  opens a command menu that performs actions.
- Read only and "This note is full" are banners that stay in view; "This note is almost
  full" is a quiet line.
- Remote carets carry the collaborator's name, which fades to the bare caret after three
  seconds without movement.

## Landing page

`src/client/landing/`, with its styles in `landing.css` (tokens only). Content stops at
1040px with 40px gutters (20px under 760px); there are no boxed card grids.

- **Top bar:** the "jot" wordmark with a blinking violet caret, then Docs and GitHub.
- **Hero, left:** the chip "Live · Lexical + Yjs 14 playground" with a static green dot; the
  headline "Just start typing." with a hand-drawn violet underline under "typing."; the
  lede; "Start a new note" with its `⌘↵` (or `Ctrl ↵`) hint and "See the example" with a
  sparkle; under them, the paste field as one quiet line.
- **Hero, right: the fan.** Three notes of one size, back to front: a recipe (static), the
  example ("Example · live", which types on its own with avatars and named carets) and a new
  note ("this device", "Untitled" with a caret, "Press any key to start"). A soft glow in
  the three author colours drifts behind them. The fan sways at rest, spreads on hover, and
  the hovered note lifts and shows "Open ↗". The new note and the example are links; the
  recipe is decoration.
- **"Try it in two windows":** two mini browser windows play the flow (a note starts, its
  link pill slides across, the second window opens it, both type with each other's carets)
  over a three-step line that fills as it plays.
- **"The engine, made visible":** four tabs (Live cursors, Blame, Offline, then merge, AI as
  a collaborator) beside one big illustrative note on a grey band that bleeds to the
  window's edge, with a state pill. The tabs advance every 3 s with a progress line;
  choosing one stops them.
- **"For Lexical developers":** links to four docs pages, "Read the docs →", and the dark
  quick-start code block.
- **"Questions":** four, separated by hairlines.
- **The ending:** "Try it, then see how it works." with "Start a new note" and "Read the
  docs →", no box; then the footer (jot and the licence, Product, Learn, Built on).

The copy is a playground's, never a hosted service's: no sign-up or retention reassurance.

## Motion

Animations use transform and opacity only, and `prefers-reduced-motion` turns every one of
them off and shows the final state.

- **The editor** moves only on state change: the pill label and Share's "Link copied" fade
  in, the toolbar and menu enter in 180 to 220ms with `cubic-bezier(0.2, 0, 0, 1)`, carets
  glide between positions. Nothing loops.
- **The landing page** has slow, continuous motion on the hero: the fan's sway (7 s), the
  drifting glow (20 s), the blinking carets and the example typing. The underline wipes in
  once. Below the hero, the two windows loop every 7.6 s and the tabs advance every 3 s.
  Under reduced motion the example shows its finished text, the windows their last step,
  and the tabs stay put.
- **Opening a note** from the landing page is a view transition: the card grows into the
  note page in 550ms. Under reduced motion it is a 150ms cross-fade.
