# D21: Ask AI runs Chrome's built-in model, and jot AI writes as an in-tab peer

Status: `DECIDED`

## Context

jot shows Lexical's Yjs 14 binding at work, and "AI as a collaborator" is one of the things
it shows: an AI edit should arrive the way a person's does, merge with concurrent typing,
and be named in blame. jot is a playground with no backend beyond the relay (D01) and no
accounts, so it can't hold API keys or pay for tokens, and it must not send notes to a third
party. Chrome now ships a Prompt API (`LanguageModel`, Gemini Nano on the device), stable on
the web. The example's demo collaborators already write through in-tab peers (D20).

## Decision

- **The model is Chrome's built-in one, through the Prompt API.** `LanguageModel.availability()`
  with English text in and out decides what the dock offers; `LanguageModel.create()` (same
  options, a system prompt, a `monitor` for download progress, an `AbortSignal`) then
  `prompt(text, { signal })`. The API is typed locally (`editor/ai/prompt-api.ts`); no new
  dependency. Where it is missing or `unavailable`, Ask AI says "Needs Chrome's built-in AI
  (Gemini Nano). Open jot in Chrome on desktop." and offers nothing else. No WebLLM, no
  Ollama, no server model.
- **Nothing is sent until the person presses Ask.** Opening the field asks the browser
  whether the model is there (local); suggestions only fill the field. Creating the model,
  which may start its download, happens on Ask, a user activation.
- **What it applies to:** the top-level blocks the selection touches, or the block with the
  caret, tinted while the field is open (`::highlight(jot-ai-target)`). The target is kept
  as the page binding's Yjs cursor, so it survives concurrent edits and resolves in another
  editor. Tables are refused (Markdown can't carry them here).
- **Markdown both ways,** with `@lexical/markdown` and the editor's own transformers: the
  target is exported as Markdown, the reply is parsed with `$generateNodesFromMarkdownString`
  and replaces the target blocks. The passage is capped at 6,000 characters and the reply
  at 20,000.
- **jot AI writes as its own in-tab peer** (D20): a registry entry of kind `ai` with
  `askedBy` the person, named "jot AI" in violet (`--peer-2`), one per asker
  (`ai-<person id>`) so blame names the right one. Its caret moves to the target while it
  thinks and stays where it wrote; it leaves the note a minute after its last request,
  and joins again, with a new client id, for the next one. Its
  edit goes through its own binding, which keeps characters a rewrite leaves unchanged, so
  blame credits jot AI with exactly what it changed. The asker gets a registry entry if
  they have none yet, so "asked by" can name them.
- **One request at a time; Esc or Stop cancels** it (the `AbortSignal` reaches `create`
  and `prompt`) and nothing is written. If the target's text changed while the model was
  thinking, nothing is written and the field says so.

## Consequences

- Ask AI works only in desktop Chrome with the model available; other browsers see the
  explanation. That fits a playground about the engine, not a writing product.
- Gemini Nano is small: rewrites of a few blocks work, long passages and non-English notes
  may not. The field says what it will rewrite before anything is sent.
- jot AI's edit is another client's edit: the person's undo doesn't revert it. Blame shows
  it instead.
- jot AI follows the in-tab peer rules (D20): a fresh client id every time it joins, its
  registry entry only with its first change (a cancelled request leaves nothing in the
  note), no writes unless the note takes edits, and it leaves when idle.
