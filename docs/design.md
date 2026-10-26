# Design

jot follows Gerard's product UI rules: a white canvas, theme tokens only, one accent, few
boxes, motion only when state changes, and text lines near 70 characters. The editor is
direction A ("Pure page") and the landing page direction 2 ("Split with action panel") of
the design mocks (D07).

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

A header with the brand and GitHub; a split hero with the headline, lede and a still
preview of a note with a remote caret on the left, and the one framed panel, "Start or
join", on the right. Below a hairline, three columns (what it is, how it works, try this),
then the footer. Two framed boxes in total: the preview and the panel where you act.

## Motion

Only on state change: the pill label and Share's "Link copied" fade in, the toolbar and
menu enter in 180 to 220ms with `cubic-bezier(0.2, 0, 0, 1)`, carets glide between
positions. Nothing loops. `prefers-reduced-motion` turns all of it off.
