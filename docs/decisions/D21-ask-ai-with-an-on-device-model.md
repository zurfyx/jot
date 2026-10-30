# D21: Ask AI runs an on-device model, and jot AI writes as an in-tab peer

Status: `DECIDED`

## Context

jot shows Lexical's Yjs 14 binding at work, and "AI as a collaborator" is one of the things
it shows: an AI edit should arrive the way a person's does, merge with concurrent typing,
and be named in blame. jot is a playground with no backend beyond the relay (D01) and no
accounts, so it can't hold API keys or pay for tokens, and it must not send notes to a third
party. Models now run in the browser: Chrome's Prompt API (`LanguageModel`, Gemini Nano)
and WebLLM on WebGPU. The example's demo collaborators already write through in-tab peers
(D20).

## Decision

- **The model runs on the device, never on a server.** Which one is D26: Chrome's built-in
  Gemini Nano, or a small or larger WebLLM model, chosen in ⋯ → AI model with a default
  that fits the device. Every model sits behind one interface (`editor/ai/backend.ts`):
  whether it is here, and a session on it. Where none can run, Ask AI says why and offers
  nothing else. No API keys, no Ollama, no server model.
- **Nothing is sent until the person presses Ask.** Opening the field asks the browser
  which model it can run and whether it is here (local); suggestions only fill the field.
  Downloading or loading a model happens on Ask, a user activation, and a WebLLM model asks
  first (D26).
- **What it applies to:** the top-level blocks the selection touches, or the block with the
  caret (a caret in a list item takes the whole list, and the field says so), tinted while
  the field is open or its request runs (`::highlight(jot-ai-target)`). The target is kept
  as the page binding's Yjs cursor, so it survives concurrent edits and resolves in another
  editor. Tables are refused (Markdown can't carry them here).
- **Markdown both ways,** with `@lexical/markdown` and the editor's own transformers: the
  target is exported as Markdown, the reply is parsed with `$generateNodesFromMarkdownString`
  and replaces the target blocks. A code fence around the reply is unwrapped only when it
  is tagged `markdown` and holds no other fence; links keep only http, https and mailto
  targets. The passage must fit the model's context window (Chrome measures it with
  `measureInputUsage()`; a WebLLM model has a character budget from its window), under a
  12,000-character ceiling; the reply is capped at 20,000 characters, refused when it was
  cut off, and refused when the note has no room for it.
- **jot AI writes as its own in-tab peer** (D20): a registry entry of kind `ai` with
  `askedBy` the person, named "jot AI" in violet (`--peer-2`), one per asker
  (`ai-<person id>`) so blame names the right one. It joins once the model is ready (not
  during a download), its caret moves to the target while it thinks and stays where it
  wrote; it leaves the note a minute after its last request, and joins again, with a new
  client id, for the next one. Its edit goes through its own binding, as exact splices
  of the words it changes, with a format change made by splitting the text where the
  format starts and ends and a change of kind (a paragraph made a list item or a heading)
  made by moving the old text into the new block, so the characters a rewrite leaves
  unchanged keep their identity: blame credits jot AI with exactly what it changed, and a
  peer's concurrent edit of them (typing, a deletion, a format, another rewrite) stays
  where it was made instead of being undone or doubled. When jot AI writes, the asker gets a registry entry if they have none yet,
  recorded as this browser's own session, so "asked by" names them, as "You" in their own
  tab.
- **One request at a time; Esc or Stop cancels** it (the `AbortSignal` reaches the
  download and the prompt) and nothing is written. jot AI reads the target from its own
  editor when it sends it, as Markdown for the model and as a lossless snapshot (every
  node's JSON); if the snapshot differs when the reply comes (text, formats such as
  underline, alignment, spaces), nothing is written and the field says so.

## Consequences

- Ask AI needs a browser that can run a model: Chrome's built-in one, or WebGPU (D26).
  Others see the explanation. That fits a playground about the engine, not a writing
  product.
- On-device models are small: rewrites of a few blocks work, long passages and non-English
  notes may not. The field says what it will rewrite before anything is sent.
- jot AI's edit is another client's edit: the person's undo doesn't revert it. Blame shows
  it instead.
- jot AI follows the in-tab peer rules (D20): a fresh client id every time it joins, its
  registry entry only with its first change (a cancelled request leaves nothing in the
  note), no writes unless the note takes edits, and it leaves when idle.
