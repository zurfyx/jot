# Design

The editor follows Gerard's product UI rules: a white canvas, theme tokens only, one accent,
few boxes, motion only when state changes, and text lines near 70 characters. It is
direction A ("Pure page") of the design mocks. The landing page is a public playground page,
so it is allowed more colour and motion: "the fan" hero, Clean in light and Night in dark,
and card-free sections below it (D07).

## Tokens

Every colour is a CSS custom property in `src/client/styles.css`, defined twice: light and
dark. `<html data-theme>` picks the set; an inline script in `index.html` sets it before
the first paint from the stored choice or `prefers-color-scheme`. ⋯ → Dark theme and ⌘K →
Toggle theme flip and remember it.

| Token                                    | Use                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| `--bg`                                   | the page, edge to edge                                    |
| `--ink`, `--body`, `--muted`             | text; muted stays above 5:1 on the page                   |
| `--rule`, `--rule-strong`                | hairlines, borders, checkbox outlines                     |
| `--hover`, `--select`                    | hover and selected rows, inline code, text selection      |
| `--accent`                               | the one accent: links, focus, checked boxes, the caret    |
| `--btn`, `--btn-ink`                     | the primary button, a draft's Share, Reconnect            |
| `--ok`, `--warn`, `--bad`                | status only, always beside a word                         |
| `--peer-0` … `--peer-7`                  | collaborators' identity colours, with `--peer-ink` labels |
| `--shadow`, `--shadow-soft`              | popovers and menus; the dock's lighter lift               |
| `--blame-faded`, `--blame-faded-opacity` | how much of their colour people out of blame's focus keep |
| `--ai`, `--ai-tint`                      | jot AI's violet (`--peer-2`); the tint on Ask AI's target |

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

The editor follows direction A ("Pure page", D07), with the chrome cut to what the
playground needs: no toolbar is always there.

- **The page.** The window is the document: a centred 680px column, 18px text, so lines
  stay near 70 characters. The note's first line is its title (styled large, and shown in
  `document.title`). There is no title field.
- **Top right,** floating on the page colour: the avatars of the people here (initials on
  their `--peer-*` colour, up to four, then "+N"; hidden under 640px), the status pill, then
  Share.
- **The status pill** is a dot whose colour repeats the word, then the word:
  - "Synced · 238 KB", the note's Yjs size (the larger of the server's figure and the local
    estimate); amber near the cap, red as "Full · 2 MB";
  - "Connecting…", "Offline · 3 edits waiting", "Syncing · 3 edits waiting" (connected,
    and the server hasn't confirmed them yet), and "Back online · merged" for four seconds
    once an offline spell's edits are confirmed;
  - "Only on this device" for a draft; "Read only" for a newer layout.

  On a shared note the pill is a button: a click toggles Work offline, and a dark
  Reconnect button sits beside it while that is on.

- **Share** is quiet on a shared note and dark on a draft, where it is the one action that
  creates the link. Both confirm with "Link copied".
- **The dock,** one floating row centred at the bottom: **Aa**, **✦ Ask AI…** and **⋯**, with
  the blame chip right before ⋯ while blame shows. Aa and Ask AI are disabled while the
  note is read only.
  - **Aa** opens block types (Text, Heading 1 to 3, Bulleted, Numbered and Todo lists,
    Quote, Code, each with its markdown shortcut as a hint) and a row of inline formats
    (bold, italic, underline, strikethrough, inline code, link). Pointer presses keep the
    editor's focus and selection.
  - **⋯** opens Show blame (a switch), Replay demo (only in an example's own tab), Note
    info (with the size), Work offline (a switch), Copy link (⌘⇧C), New note and Dark
    theme (a switch).
  - **Note info:** the Yjs size as "238 KB of 2 MB" with a meter, "Here now" (colour, name,
    editing or idle), and "Kept until <date> · 90 days after the last visit".
  - **Ask AI** (D21) looks like a field: a violet spark and "Ask AI…" in `--muted` on
    `--hover`, about 190px wide (narrower on a phone); while jot AI works it reads "jot AI
    is writing…" in violet. It opens a panel above the dock: an input with a 1px `--ai`
    border, the spark and a dark Ask button (Stop while a request runs); suggestion chips
    that only fill the input; and a quiet line saying what happens ("Rewrites this block ·
    runs on this device", "Rewrites the whole list", "Rewrites 3 blocks", "Writes into the
    empty line", the download
    with a violet meter, "jot AI is writing… Esc to cancel", or an error in `--bad`).
    The target blocks carry `--ai-tint` (`::highlight(jot-ai-target)`) while the panel is
    open or a request runs. Without the model, the panel holds only "Needs Chrome's
    built-in AI (Gemini Nano). Open jot in Chrome on desktop." jot AI is "jot AI" in
    violet (`--peer-2`) on its caret, in blame and in Note info.
  - Menus open above the dock, move with the arrow keys and close on Escape or a press
    outside.
- **Blame** (D19), drawn over the page without changing it:
  - a 2px underline in each author's `--peer-*` colour (the CSS Custom Highlight API);
  - in the margin, a 3px bar per run of lines with the same main author, and their name
    at the top of the run, right aligned beside the bar. Under 900px the names go and the
    bars stay; under 640px the bars sit in the column's padding;
  - "Blame" and up to four colour dots on `--select`, in the dock; it opens the legend:
    a row per person (dot, name, share), "Click a name to focus" and "Hide blame". A
    focused person keeps full colour and everyone else fades;
  - hovering attributed text shows a small card: the name in bold, then "wrote this ·
    last active 5 min ago", and for AI "· asked by <name>";
  - the person in this browser is "You". Two people with one colour are kept apart: the
    smaller share takes the next free colour.
- **The example note** (D20) is the editor page with one addition: a slim banner above the
  title, "**Example note** · Ana and jot AI are demos in your browser", with two quiet
  buttons, Copy link and Start blank. It is a bordered, softly shadowed pill as wide as its
  content, wrapping on a phone. The demo collaborators are "Ana (demo)" in orange
  (`--peer-1`) and "jot AI (demo)" in violet (`--peer-2`): their carets, avatars, blame
  bars and underlines use those colours. Their edits are content, not motion: under
  reduced motion the whole demo lands at once.
- A new note shows the placeholder "Untitled" and "Start writing. Anyone with this link can
  edit." (a draft: "It stays on this device until you press Share."). ⌘K opens a command
  menu that performs actions.
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

## Docs

`src/client/docs/`, with its styles in `docs.css` (tokens only). The base tokens, light
and dark, plus a `.docs` scope: the example people's colours (`--you`, `--ana`, `--ai`),
their tints for the home's hero and the diagram (`--docs-tint-*`), the inspector's
highlight (`--docs-hl`), callouts (`--docs-callout-*`, `--docs-warn-*`) and light code
blocks (`--docs-code-*`).

- **Header:** "jot docs", then Guides, API (`@lexical/y`'s README at the pinned Lexical
  commit) and GitHub. Under 860px the nav folds behind a Pages button.
- **Nav:** a left column grouped Start, Concepts, Features and Server, each page marked
  with a person's colour; the current page has the hover fill.
- **Pages:** a 720px column (prose capped near 68 characters), a breadcrumb, the title,
  then short sections around one snippet each. Previous and Next close every page.
- **Code blocks:** the file name (linked to the source on GitHub) and a Copy button over
  the code, keywords and strings tinted.
- **The inspector:** the editor on the left, the `lexical-y` rows on the right in mono
  (stacked under 1080px). The active line and its row share a violet tint; the pointer or
  the caret, whichever moved last, picks it.
- **The relay diagram** is boxes and arrows in HTML, a row on desktop and a column on a
  phone, so its text never shrinks.
- No motion: hover fills change at once.

## Motion

Animations use transform and opacity only, and `prefers-reduced-motion` turns every one of
them off and shows the final state.

- **The editor** moves only on state change: the pill label, the avatars and Share's
  "Link copied" fade in; the dock's popovers and the ⌘K menu rise in over 180 to 220ms with
  `cubic-bezier(0.2, 0, 0, 1)`; switches slide; the size meter scales; carets glide between
  positions; blame's margin and chip fade in, and focus fades the others. Nothing loops.
- **The landing page** has slow, continuous motion on the hero: the fan's sway (7 s), the
  drifting glow (20 s), the blinking carets and the example typing. The underline wipes in
  once. Below the hero, the two windows loop every 7.6 s and the tabs advance every 3 s.
  The hero's loops and the two windows hold still while off screen or in a hidden tab.
  Under reduced motion the example shows its finished text, the windows their last step,
  and the tabs stay put.
- **Opening a note** from the landing page loads the editor chunk first, then runs a view
  transition: the card grows into the note page in 550ms. Under reduced motion it is a
  150ms cross-fade.
- Hover and focus states (links, the paste line, the tabs) change at once, without a
  colour transition.
