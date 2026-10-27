# D26: Ask AI offers three on-device models: Chrome's, and two WebLLM models

Status: `DECIDED`

## Context

Ask AI (D21) ran only on Chrome's built-in Gemini Nano, through the Prompt API, which Chrome
offers to web pages on desktop only. A person trying jot on a phone got an explanation and
nothing else. WebLLM (`@mlc-ai/web-llm`) runs small open models in any browser with WebGPU
(Chrome and Edge on desktop and Android, Safari 26 on iPhone, iPad and Mac), downloading
them from Hugging Face into the browser's cache.

## Decision

- **Three models, one setting.** ⋯ → AI model lists them with where each runs, its
  download and its state on this device (Ready, Needs download, Downloaded, Not supported
  on this device). The choice is kept per browser (`localStorage` `jot:ai-model`); Ask AI
  uses it, or the default, with no question on each Ask.

  | Setting         | Model                                        | Download | Runs on                    |
  | --------------- | -------------------------------------------- | -------- | -------------------------- |
  | Chrome built-in | Gemini Nano (Prompt API)                     | Chrome's | Chrome and Edge on desktop |
  | Small           | `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` (or f32) | 300 MB   | WebGPU; meant for phones   |
  | Larger          | `Qwen3-1.7B-q4f16_1-MLC` (or f32)            | 990 MB   | WebGPU; meant for laptops  |

  The f16 build is used where the adapter has `shader-f16`, the f32 build otherwise (same
  download, a little more GPU memory). Sizes are each Hugging Face repo plus its WebGPU
  library.

- **The default** (`models.ts`, pure and unit tested): Chrome's model when
  `LanguageModel.availability()` says `available`; otherwise WebLLM when WebGPU has a
  hardware adapter (a SwiftShader fallback adapter doesn't count): Small on a phone, a
  tablet or a device with 4 GB of memory or less (UA-CH `mobile`, the user agent, an iPad's
  touch, `navigator.deviceMemory`, a screen under 600px on its short side), Larger
  elsewhere; otherwise Chrome's model if Chrome can still download it; otherwise none, and
  Ask AI says why ("no WebGPU and no built-in AI", or "no usable graphics adapter"). A
  chosen model that can't run here falls back to the default.
- **Nothing downloads without a yes.** A WebLLM model that isn't here stops Ask at a
  question in the panel: "Ask AI needs a 300 MB model on this device (Qwen2.5 0.5B).
  Download it?", with a mobile-data note on phones, Download and Not now. The download
  shows its progress in the panel and Esc or Stop cancels it (the worker stops; shards
  already fetched stay cached). jot remembers what it downloaded (`jot:ai-downloaded`) so
  the setting needs no WebLLM to show it, and checks WebLLM's cache before loading: a
  model the browser evicted asks again. Delete in the setting removes a model from the
  cache. Chrome's model keeps Chrome's own flow: its download starts on the first Ask.
- **WebLLM runs in a worker, loaded only when used.** `editor/ai/webllm/worker.ts` runs
  WebLLM's `MLCEngine` and is the only file that imports WebLLM; the page speaks a small
  protocol to it (`has`, `delete`, `load` with progress, `chat`, `interrupt`). WebLLM's own
  worker client would load its whole bundle on the page too: about 2.1 MB compressed, which
  doesn't tree-shake. The worker starts on an Ask or a Delete, never on page load; a test
  checks that only the worker imports WebLLM. The loaded model stays in GPU memory for 5
  minutes after its last use, then the worker stops. Models and their WebGPU libraries come
  from WebLLM's default hosts (huggingface.co and its CDN, raw.githubusercontent.com),
  never from R2 or the Worker; jot sends no Content-Security-Policy that would block them.
  The worker script is served with `Referrer-Policy: no-referrer` (`public/_headers`, for
  `/assets/webllm-*`): huggingface.co answers 404, with no CORS headers, to a request from
  a `*.workers.dev` page that sends both an Origin and a Referer, which is every branch
  Preview (D24); without the Referer it serves them, and Hugging Face learns less.
- **The same safeguards for every model** (D21): explicit Ask, whole-list targets, the
  lossless snapshot check, the note's room, jot AI as an in-tab peer (kind `ai`,
  `askedBy`), Esc cancels, one request at a time. For WebLLM the passage limit comes from
  the 4,096-token context window (5,544 characters, at three a token, so the passage and
  its rewrite both fit), a reply may take about twice the passage, and a reply that ran
  out of room is refused, not written. Replies stay Markdown with the existing cleanup;
  Qwen3's empty `<think>` block is stripped. Qwen3 runs without thinking
  (`enable_thinking: false`), with its recommended sampling and presence penalty.

## Why these models

Tested in jot on an M-series Mac (Chrome, Metal WebGPU) with jot's own system prompt and
four instructions ("Make it a list", "Fix the spelling", "Shorter", "Make it a numbered
list", plus "Make it more formal" and "Add a title" for the finalists):

- **Qwen2.5 0.5B Instruct** made real lists, fixed spelling mostly, and stayed short and
  on topic; about 0.3 s a reply once loaded. It also needs the least GPU memory of the
  candidates (about 0.9 GB), which matters most on phones.
- **Qwen3 0.6B** (the first idea for Small) copied the prompt's Markdown examples: it
  answered "Fix the spelling" with `- [ ]` repeated until its budget ran out, and left the
  text unchanged with a shorter prompt. It needs 1.4 GB of GPU memory.
- **Llama 3.2 1B Instruct** invented headings and to-do lists, and looped on a numbered
  list. The **Gemma 3 1B** prebuilt record doesn't load in WebLLM 0.2.86 (it sets both a
  context and a sliding window).
- **Qwen3 1.7B** was the most faithful of the larger ones: correct lists and spelling,
  nothing invented, about 0.4 s a reply. Qwen2.5 1.5B wrote a better formal tone but kept
  the typos and turned "Add a title" into a bullet. Qwen3 1.7B is the best model near 1 GB.

## Consequences

- Ask AI works on phones and in browsers other than Chrome, wherever WebGPU does. Without
  WebGPU (some Firefox and Linux builds, older Safari, many Android WebViews) and without
  Chrome's model, it still only explains.
- Small models are weak: none of them reliably shortens a passage or numbers a list, and
  Small sometimes rewrites words it shouldn't. The snapshot check and blame keep their
  edits honest; they are a demo of the binding, not a writing assistant.
- Downloads are big for a playground: 300 MB or 990 MB, once per browser (and per
  f16/f32 build). On a phone that is mobile data and storage; the question says so first.
- Running a model costs memory and battery: Larger needs about 2 GB of GPU memory, and a
  phone runs warm while it writes. The model leaves memory after 5 idle minutes.
- Safari (iOS) may evict the cache under storage pressure or after weeks without visits;
  jot asks the browser to persist storage after a download and asks again before
  downloading if the model is gone.
- After a deploy, a tab opened before it may fail to start the worker (the old hashed file
  is gone); the field says the model couldn't start, and a reload fixes it.
- WebLLM's prebuilt model list moves with its version: a WebLLM bump must check that both
  ids are still in `prebuiltAppConfig`; a unit test checks them, with their context window.
