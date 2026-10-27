# Design

The editor follows Gerard's product UI rules: a white canvas, theme tokens only, one accent,
few boxes, motion only when state changes, and text lines near 70 characters. It is
direction A ("Pure page") of the design mocks. The landing page is a public playground page,
so it is allowed more colour and motion: "the fan" hero, Clean in light and Night in dark,
and card-free sections below it (D07).

## Tokens

Every colour is a StyleX variable in `src/client/theme/tokens.stylex.ts` (`defineVars`,
light values), with its dark value in `globals.css` under `:root[data-theme='dark']`. The
variables keep their literal names (`--bg`), so plain CSS reads them too. `<html data-theme>`
picks the set: an inline script in `index.html` sets it before the first paint from the
stored choice or `prefers-color-scheme`, so dark mode never flashes white. ⋯ → Dark theme and
⌘K → Toggle theme flip and remember it.

| Token                                    | Use                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| `--bg`                                   | the page, edge to edge                                    |
| `--ink`, `--body`, `--muted`             | text; muted stays above 5:1 on the page                   |
| `--rule`, `--rule-strong`                | hairlines, borders, checkbox outlines                     |
| `--hover`, `--select`                    | hover and selected rows, inline code, text selection      |
| `--accent`                               | the one accent: links, focus, checked boxes, the caret    |
| `--btn`, `--btn-ink`                     | the primary button, Reconnect                             |
| `--ok`, `--warn`, `--bad`                | status only, always beside a word                         |
| `--peer-0` … `--peer-7`                  | collaborators' identity colours, with `--peer-ink` labels |
| `--shadow`, `--shadow-soft`              | popovers and menus; the dock's lighter lift               |
| `--blame-faded`, `--blame-faded-opacity` | how much of their colour people out of blame's focus keep |
| `--ai`, `--ai-tint`                      | jot AI's violet (`--peer-2`); the tint on Ask AI's target |
| `--scrollbar`                            | the scrollbar thumb, on a transparent track               |

The landing page scopes a second set on its root (`landing` in `tokens.stylex.ts`, its dark
values in `themes.ts`). In dark it re-points the base tokens to the Night treatment (a deep
navy `--landing-bg`, a brighter glow), so its styles read the same names.

| Token                                 | Use                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| `--landing-bg`                        | the landing page and the body behind it              |
| `--you`, `--ana`, `--ai`              | the example people: green, orange and violet (peers) |
| `--card`, `--card-rule`               | the fan's notes and the mini windows                 |
| `--card-highlight`, `--card-shadow-*` | their top highlight and layered shadows              |
| `--button-shadow`                     | the primary button's drop shadow                     |
| `--glow-opacity`                      | the glow behind the fan (0.5 Clean, 0.75 Night)      |
| `--code-bg`, `--code-ink`, `--code-*` | the dark code block, its keywords, strings and thumb |

Scrollbars follow Notion everywhere (the page, menus, the docs nav, code blocks): no track,
and a thin, translucent thumb in the theme's ink, from `scrollbar-color: var(--scrollbar)
transparent` and `scrollbar-width: thin`. There are no `::-webkit-scrollbar` rules: in a
Safari without `scrollbar-color` they would turn macOS overlay scrollbars into permanent
classic ones that take width from the column, so such a Safari keeps its native scrollbars.
The landing page's code block is dark in both themes, so it points `--scrollbar` at the
light `--code-scrollbar`.

## Styling

Styles are StyleX (D28): `stylex.create` beside each component, compiled at build time
(`scripts/vite-stylex.ts`) into atomic classes. Each module's rules travel with its chunk,
so the landing page loads only its own styles and the note page's and the docs' arrive with
their lazy chunks; every StyleX priority is a cascade layer declared up front, so the order
stylesheets load in doesn't change the result. Motion is `stylex.keyframes` and, for opening
a note, `stylex.viewTransitionClass`; hover, focus and sibling rules use `stylex.when.*` with
markers; Lexical's theme (`editor/extensions.ts`) maps node types to StyleX classes.
`src/client/globals.css` holds only what StyleX can't write, each rule with a one-line
reason: `color-scheme` and the dark token values, the element defaults (in the `reset` layer,
under every StyleX class), `<body>`, the reduced-motion switch, `::highlight()` for Ask AI
and a table selection's `::selection`; the inspector keeps one rule in `docs/docs.css`.

## Type

Geist (`@fontsource-variable/geist`) for everything; Geist Mono only for codes and ids
(inline code, the note code in "Opens note k3Jd9x…"). Sentence case, short labels.

## Editor page

The editor follows direction A ("Pure page", D07), with the chrome cut to what the
playground needs: no toolbar is always there.

- **The page.** The window is the document: a centred 680px column, 18px text, so lines
  stay near 70 characters. The note's first line is its title (styled large, and shown in
  `document.title`). There is no title field. The page is one window tall (`100svh`) until
  the note outgrows it, so an empty note never scrolls. Below the last line the column
  keeps 45% of the window (`45svh`), so a long note's last line can scroll up clear of the
  dock, and while typing the caret line stays above the dock: the root's
  `scroll-padding-bottom` covers the dock, and Lexical's scroll-into-view respects it.
- **The whole page writes,** as in Notion: a click or tap anywhere on the blank page puts
  the caret in the note. Below the text it goes to the end, on a new empty line when the
  note ends in an image, a code block, a table or a quote; beside a line, in the margins,
  to the nearest point of that line; above the title, into the first line. Controls,
  links, images, menus and banners keep their clicks, a press outside an open menu only
  closes it, a selection drag keeps its selection, and nothing scrolls.
- **Top right,** floating on the page colour: the avatars of the people here (initials on
  their `--peer-*` colour, up to four, then "+N"; hidden under 640px), the status pill, then
  Share.
- **The status pill** is a dot whose colour repeats the word, then the word:
  - "Synced · 238 KB", the note's Yjs size (the larger of the server's figure and the local
    estimate); amber near the cap, red as "Full · 2 MB";
  - "Connecting…", "Offline · 3 edits waiting", "Syncing · 3 edits waiting" (connected,
    and the server hasn't confirmed them yet), and "Back online · merged" for four seconds
    once an offline spell's edits are confirmed;
  - "Read only" for a newer layout.

  The pill is a button: a click toggles Work offline, and a dark Reconnect button sits
  beside it while that is on.

- **Share** is quiet: the note already has its link, so it only copies it, and confirms
  with "Link copied".
- **The dock,** one floating row centred at the bottom: **Aa**, **✦ Ask AI…** and **⋯**, with
  the blame chip right before ⋯ while blame shows. Aa and Ask AI are disabled while the
  note is read only.
  - **Aa** opens block types (Text, Heading 1 to 3, Bulleted, Numbered and Todo lists,
    Quote, Code, each with its markdown shortcut as a hint) and a row of inline formats
    (bold, italic, underline, strikethrough, inline code, link). Pointer presses keep the
    editor's focus and selection.
  - **⋯** opens Show blame (a switch), Replay demo (only in an example's own tab), Note
    info (with the size), AI model (with the model Ask AI uses, "Small"), Work offline (a
    switch), Copy link (⌘⇧C), New note and Dark theme (a switch).
  - **Note info:** the Yjs size as "238 KB of 2 MB" with a meter, "Here now" (colour, name,
    editing or idle), and "Kept until <date> · 90 days after the last visit".
  - **AI model** (D26) opens in the menu's place like Note info: "AI model", a muted line
    ("Ask AI's model runs on this device, so your text never leaves it."), then a row per
    model: a violet radio, the name ("Small · default here") with its state on the right
    ("Ready" and "Downloaded" in `--ok`, "Needs download", "Partly downloaded", "Not
    supported on this device", or "Downloading 42%", announced politely), then two muted
    lines, the model and its download ("Qwen2.5 0.5B · 300 MB") and where it runs ("In the
    browser, best on phones"). A downloaded or partly downloaded WebLLM model has a quiet
    Delete, labelled with the model's name. Rows that can't run here are muted and
    disabled.
  - **Ask AI** (D21) looks like a field: a violet spark and "Ask AI…" in `--muted` on
    `--hover`, about 190px wide (narrower on a phone); while jot AI works it reads "jot AI
    is writing…" in violet. It opens a panel above the dock: an input with a 1px `--ai`
    border, the spark and a dark Ask button (Stop while a request runs); suggestion chips
    that only fill the input; and a quiet line saying what happens ("Rewrites this block ·
    Gemini Nano, on this device", "Rewrites the whole list", "Rewrites 3 blocks", "Writes
    into the empty line", "· Qwen2.5 0.5B (300 MB) downloads after you agree", the download
    or the load with a violet meter, "jot AI is writing… Esc to cancel", or an error in
    `--bad`). Before a WebLLM download the line gives way to the question: "Ask AI needs a
    300 MB model on this device (Qwen2.5 0.5B). Download it?", on a phone a muted
    mobile-data note, then the dark Download button (which takes the focus), a quiet Not
    now and "Or pick another in ⋯ → AI model". The target blocks carry `--ai-tint` (`::highlight(jot-ai-target)`)
    while the panel is open or a request runs. Where no model can run, the panel holds
    only why ("Ask AI runs a model on this device, and this browser can't: it has no
    WebGPU and no built-in AI. Try a recent Chrome, Edge or Safari."). jot AI is "jot AI"
    in violet (`--peer-2`) on its caret, in blame and in Note info.
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
  edit." ⌘K opens a command menu that performs actions.
- Read only and "This note is full" are banners that stay in view; "This note is almost
  full" is a quiet line.
- Remote carets carry the collaborator's name, which fades to the bare caret after three
  seconds without movement.

## Landing page

`src/client/landing/`, styled with StyleX beside each component (tokens only; shared section
styles in `section.styles.ts`, relational markers in `markers.stylex.ts`). Content stops at
1040px with 40px gutters (20px under 760px); there are no boxed card grids.

- **Top bar:** the "jot" wordmark with a blinking violet caret, then Docs and GitHub.
- **Hero, left:** the chip "Live · Lexical + Yjs 14 playground" with a static green dot; the
  headline "Just start typing." with a hand-drawn violet underline under "typing."; the
  lede; "Start a new note" with its `⌘↵` (or `Ctrl ↵`) hint and "See the example" with a
  sparkle; under them, the paste field as one quiet line.
- **Hero, right: the fan.** Three notes of one size, back to front: a recipe (static), the
  example ("Example · live", which types on its own with avatars and named carets) and a new
  note ("its own link", "Untitled" with a caret, "Press any key to start"). A soft glow in
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

`src/client/docs/`, styled with StyleX in each component's file (tokens only). The prose
elements are small components in `ui.tsx` (`P`, `H2`, `Ul`, `Li`, `B`, `C` for inline
code), so a page's JSX carries its look. The base tokens, light and dark, plus the `docs`
set (`docsDark` on the docs root): the people's tints for the home's hero and the diagram
(`--docs-tint-*`), the inspector's highlight (`--docs-hl`), callouts (`--docs-callout-*`,
`--docs-warn-*`) and light code blocks (`--docs-code-*`). The pages and the diagram are
marked with the peer colours of you, Ana and jot AI (`tint.ts`). One plain rule is left in
`docs.css`: the classless `<code>` Lexical wraps inline code in, inside the inspector.

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
  transition: the clicked card (the New note card for "Start a new note" and the keys, the
  example card for the example) grows from where it sits into the note page in 450ms with
  `cubic-bezier(0.2, 0, 0, 1)`, straightening and losing its rounded corners on the way.
  Both pictures fill the growing sheet, on the page colour (cover, anchored top centre),
  and cross-fade in its first 20%, while it is still near card size, so the scaled-up card
  never shows through the page; the rest of the landing page fades out in 300ms. Under reduced motion it is a 150ms cross-fade.
- Hover and focus states (links, the paste line, the tabs) change at once, without a
  colour transition.
