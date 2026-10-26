/**
 * Ask AI (D21): an instruction, applied by Chrome's built-in model to the
 * selected blocks (or the block with the caret), written into the note by
 * jot AI: an in-tab peer of its own (D20), so the edit reaches everyone
 * through the relay and blame names jot AI, asked by this person. It joins
 * once the model is ready and leaves a minute after its last request.
 *
 * Nothing leaves the page, and nothing is sent to the model unless the
 * person presses Ask. One request at a time; `cancel` (Esc) stops it.
 */
import { type ReadonlySignal, signal } from '@lexical/extension';
import type { YBinding, YCursor } from '@lexical/y';
import type { Awareness } from '@y/protocols/awareness';
import type * as Y from '@y/y';
import { $isListNode } from '@lexical/list';
import type { LexicalEditor } from 'lexical';

import { NOTE_MAX_BYTES } from '../../../shared/limits';
import { localPersonId, ownClientIds, readRegistry, writeLocalEntry } from '../blame/registry';
import { createInTabPeer, type InTabPeer, type PeerPerson } from '../peers/peer';
import { localUser, type PeerUser } from '../presence';
import type { NoteSession } from '../session';
import {
  $blocksToMarkdown,
  $replaceBlocks,
  $snapshotBlocks,
  $targetBetween,
  buildPrompt,
  cleanReply,
  MAX_PASSAGE,
  SYSTEM_PROMPT,
  type Target,
} from './markdown';
import {
  type AiAvailability,
  checkAvailability,
  type LanguageModelApi,
  languageModel,
  MODEL_OPTIONS,
  type ModelSession,
  progressOf,
} from './prompt-api';

/** jot AI's name, on its caret and in blame. */
export const JOT_AI_NAME = 'jot AI';
/** Violet: `--peer-2`, the `--ai` token (docs/design.md). */
export const JOT_AI_COLOR = 2;
/**
 * jot AI stays this long after writing, its caret where it wrote, then leaves
 * the note (a peer mirrors every change to the note while it lives; D20).
 */
export const AI_LINGER_MS = 60_000;
/**
 * Room a reply needs in the note: its Markdown twice over (Yjs structure,
 * attributes and the registry) plus a margin.
 */
export function roomFor(markdown: string): number {
  return new TextEncoder().encode(markdown).byteLength * 2 + 2048;
}

export const MESSAGES = {
  unavailable: "Needs Chrome's built-in AI (Gemini Nano). Open jot in Chrome on desktop.",
  noTarget:
    'Click in the note first: jot AI works on the selected blocks, or the one with the caret.',
  table: "jot AI can't rewrite tables yet. Select text outside the table.",
  image: "jot AI can't rewrite images. Select text without an image.",
  tooLong: 'That is more text than the on-device model can take. Select fewer blocks.',
  readOnly: "This note can't be edited right now.",
  full: 'This note is too full for what jot AI wrote.',
  empty: 'jot AI had nothing to write. Try another instruction.',
  changed: 'The text changed while jot AI was thinking. Ask again.',
  failed: "jot AI couldn't answer. Try again.",
} as const;

export type AiPhase =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: number | null }
  | { kind: 'thinking' }
  | { kind: 'error'; message: string };

/** What a request applies to, described for the field. */
export interface TargetInfo {
  blocks: number;
  /** The one block is empty: jot AI writes into it. */
  empty: boolean;
  /** The one block is a list: a caret in any item rewrites all of it. */
  list: boolean;
  problem: Target['problem'];
}

/** The page's side of a note, as jot AI needs it. */
export interface AiHost {
  doc: Y.Doc;
  awareness: Awareness;
  editor: LexicalEditor;
  binding: YBinding;
  connection?: ReadonlySignal<string>;
  /** The note takes edits now (editable, and not full). Peers are gated on it too. */
  writable(): boolean;
  /** Bytes the note can still grow by before its cap; unlimited when absent. */
  room?(): number;
}

export interface AiDeps {
  api(): LanguageModelApi | null;
  personId(): string;
  user(): PeerUser;
  /** Defaults to AI_LINGER_MS. */
  lingerMs?: number;
}

export interface AiState {
  availability: ReadonlySignal<AiAvailability | 'checking'>;
  phase: ReadonlySignal<AiPhase>;
  /** The selection the next request applies to, as a Yjs cursor. */
  target: ReadonlySignal<YCursor | null>;
  targetInfo: ReadonlySignal<TargetInfo | null>;
  /** Counts the edits jot AI has written. */
  written: ReadonlySignal<number>;
  /** Asks the browser whether the model is there (local; sends nothing). */
  refresh(): Promise<void>;
  /** Takes the page's selection as the target of the next request (the field opened). */
  capture(): void;
  /** Sends the instruction and the target to the model. Resolves true once jot AI wrote. */
  ask(instruction: string): Promise<boolean>;
  /** Stops the running request; nothing is written. */
  cancel(): void;
  /** Clears an error. */
  dismiss(): void;
  /**
   * The field closed: forgets the target now, or, while a request runs on
   * it, as soon as that request settles.
   */
  release(): void;
  /** Leaving the page: cancels, and jot AI leaves the note at once (its writes stay). */
  stop(): void;
}

class Cancelled extends Error {}

export function createAiState(host: AiHost, deps: AiDeps): AiState {
  const availability = signal<AiAvailability | 'checking'>('checking');
  const phase = signal<AiPhase>({ kind: 'idle' });
  const target = signal<YCursor | null>(null);
  const targetInfo = signal<TargetInfo | null>(null);
  const written = signal(0);
  let running: AbortController | null = null;
  let released = false;
  let peer: InTabPeer | null = null;
  let lingering: ReturnType<typeof setTimeout> | null = null;

  const stopLingering = () => {
    if (lingering !== null) {
      clearTimeout(lingering);
      lingering = null;
    }
  };
  const leave = () => {
    stopLingering();
    peer?.dispose();
    peer = null;
  };
  /** jot AI leaves a while after its last request. */
  const linger = () => {
    stopLingering();
    lingering = setTimeout(() => {
      lingering = null;
      if (running === null) {
        leave();
      }
    }, deps.lingerMs ?? AI_LINGER_MS);
  };
  const forgetTarget = () => {
    target.value = null;
    targetInfo.value = null;
  };

  /** The target as the page's editor has it now. */
  const readTarget = (cursor: YCursor) =>
    host.editor.getEditorState().read(() => {
      const points = host.binding.$resolveCursor(cursor);
      const found = points === null ? null : $targetBetween(points.anchor, points.focus);
      if (found === null) {
        return null;
      }
      const only = found.blocks.length === 1 ? found.blocks[0]! : null;
      return {
        problem: found.problem,
        blocks: found.blocks.length,
        empty: only !== null && only.getTextContent().trim() === '',
        list: only !== null && $isListNode(only),
        markdown: found.problem === 'none' ? $blocksToMarkdown(found.blocks) : '',
      };
    });

  /** jot AI joins for a request, and lingers after it (see AI_LINGER_MS). */
  const joinPeer = (): InTabPeer => {
    stopLingering();
    if (peer === null) {
      const asker = deps.personId();
      const person: PeerPerson = {
        // One jot AI per person who asks, so blame names the right asker.
        personId: `ai-${asker}`.slice(0, 32),
        name: JOT_AI_NAME,
        color: JOT_AI_COLOR,
        kind: 'ai',
        askedBy: asker,
      };
      // A fresh client id every time; the registry entry comes with its first change.
      peer = createInTabPeer(host, person);
    }
    return peer;
  };

  /**
   * Blame's "asked by" needs the asker in the registry, as this browser's own
   * session, even before they have typed anything.
   */
  const registerAsker = () => {
    const { doc } = host;
    if (!ownClientIds().has(doc.clientID) || !readRegistry(doc).clients.has(doc.clientID)) {
      writeLocalEntry(doc, deps.personId(), deps.user());
    }
  };

  const refresh = async () => {
    const result = await checkAvailability(deps.api());
    // A download that started meanwhile knows better.
    if (running === null || result === 'available') {
      availability.value = result;
    }
  };

  /** What `ask` resolves to, once the request is over. */
  const settle = (controller: AbortController, outcome: AiPhase): void => {
    if (running !== controller) {
      // Cancelled: `cancel` already set the phase, and a newer request may own it now.
      return;
    }
    running = null;
    phase.value = outcome;
    if (released) {
      released = false;
      forgetTarget();
    }
  };

  const run = async (controller: AbortController, cursor: YCursor, text: string) => {
    const { signal: abort } = controller;
    const check = () => {
      if (abort.aborted || running !== controller) {
        throw new Cancelled();
      }
    };
    const api = deps.api()!;
    let model: ModelSession | null = null;
    try {
      model = await api.create({
        ...MODEL_OPTIONS,
        initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
        signal: abort,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            if (running === controller && phase.peek().kind === 'downloading') {
              phase.value = { kind: 'downloading', progress: progressOf(event) };
            }
          });
        },
      });
      check();
      availability.value = 'available';
      phase.value = { kind: 'thinking' };
      if (!host.writable()) {
        return MESSAGES.readOnly;
      }

      // The model is ready: jot AI joins, its caret on the blocks it works on,
      // and reads them from its own editor: the Markdown for the model, and a
      // lossless snapshot to tell, before writing, whether anyone changed them.
      const ai = joinPeer();
      let sent: { markdown: string; snapshot: string } | null = null;
      ai.edit(() => {
        const points = ai.binding.$resolveCursor(cursor);
        const found = points && $targetBetween(points.anchor, points.focus);
        if (found !== null && found.problem === 'none' && found.blocks.length > 0) {
          sent = {
            markdown: $blocksToMarkdown(found.blocks),
            snapshot: $snapshotBlocks(found.blocks),
          };
          found.blocks[0]!.selectStart();
        }
      });
      const read = sent as { markdown: string; snapshot: string } | null;
      if (read === null) {
        return MESSAGES.changed;
      }
      const prompt = buildPrompt(text, read.markdown);
      if (read.markdown.length > MAX_PASSAGE) {
        return MESSAGES.tooLong;
      }
      if (typeof model.measureInputUsage === 'function' && typeof model.inputQuota === 'number') {
        const usage = await model.measureInputUsage(prompt, { signal: abort });
        check();
        if (usage > model.inputQuota - (model.inputUsage ?? 0)) {
          return MESSAGES.tooLong;
        }
      }

      const reply = await model.prompt(prompt, { signal: abort });
      check();
      const markdown = cleanReply(reply);
      if (markdown === '') {
        return MESSAGES.empty;
      }
      if (!host.writable()) {
        return MESSAGES.readOnly;
      }
      if (host.room !== undefined && host.room() < roomFor(markdown)) {
        return MESSAGES.full;
      }
      let outcome: 'written' | 'changed' | 'empty' = 'changed';
      const ok = ai.edit(() => {
        const points = ai.binding.$resolveCursor(cursor);
        const found = points && $targetBetween(points.anchor, points.focus);
        if (
          found === null ||
          found.problem !== 'none' ||
          $snapshotBlocks(found.blocks) !== read.snapshot
        ) {
          outcome = 'changed';
          return;
        }
        const last = $replaceBlocks(found.blocks, markdown);
        if (last === null) {
          outcome = 'empty';
          return;
        }
        last.selectEnd();
        outcome = 'written';
      });
      if (!ok) {
        return host.writable() ? MESSAGES.failed : MESSAGES.readOnly;
      }
      switch (outcome as 'written' | 'changed' | 'empty') {
        case 'written':
          registerAsker();
          written.value += 1;
          forgetTarget();
          return null;
        case 'empty':
          return MESSAGES.empty;
        case 'changed':
          return MESSAGES.changed;
      }
    } finally {
      try {
        model?.destroy();
      } catch {
        // Already gone.
      }
    }
  };

  return {
    availability,
    phase,
    target,
    targetInfo,
    written,
    refresh,
    capture() {
      if (running !== null) {
        // The field reopened on the running request: keep its target.
        released = false;
        return;
      }
      released = false;
      const cursor = host.binding.getCursor();
      target.value = cursor;
      let info: TargetInfo | null = null;
      if (cursor !== null) {
        try {
          const read = readTarget(cursor);
          info = read && {
            blocks: read.blocks,
            empty: read.empty,
            list: read.list,
            problem: read.problem,
          };
        } catch {
          info = null;
        }
      }
      targetInfo.value = info;
      if (phase.peek().kind === 'error') {
        phase.value = { kind: 'idle' };
      }
    },
    async ask(instruction) {
      const text = instruction.trim();
      if (text === '' || running !== null) {
        return false;
      }
      const fail = (message: string) => {
        phase.value = { kind: 'error', message };
        return false;
      };
      if (availability.peek() === 'checking') {
        await refresh();
      }
      const status = availability.peek();
      if (deps.api() === null || status === 'missing' || status === 'unavailable') {
        return fail(MESSAGES.unavailable);
      }
      const cursor = target.peek();
      if (cursor === null) {
        return fail(MESSAGES.noTarget);
      }
      if (!host.writable()) {
        return fail(MESSAGES.readOnly);
      }
      // Early answers from the page's own editor; jot AI reads the target again
      // once the model is ready.
      let early: ReturnType<typeof readTarget>;
      try {
        early = readTarget(cursor);
      } catch {
        early = null;
      }
      if (early === null) {
        return fail(MESSAGES.noTarget);
      }
      if (early.problem !== 'none') {
        return fail(early.problem === 'image' ? MESSAGES.image : MESSAGES.table);
      }
      if (early.markdown.length > MAX_PASSAGE) {
        return fail(MESSAGES.tooLong);
      }

      const controller = new AbortController();
      running = controller;
      phase.value =
        status === 'available' ? { kind: 'thinking' } : { kind: 'downloading', progress: null };
      let message: string | null;
      try {
        message = await run(controller, cursor, text);
      } catch (error) {
        if (error instanceof Cancelled || controller.signal.aborted) {
          // `cancel` set the phase; only a request still current resets it.
          settle(controller, { kind: 'idle' });
          return false;
        }
        console.warn('jot: Ask AI failed', error);
        message = MESSAGES.failed;
      } finally {
        if (peer !== null && (running === null || running === controller)) {
          linger();
        }
      }
      settle(controller, message === null ? { kind: 'idle' } : { kind: 'error', message });
      return message === null;
    },
    cancel() {
      if (running !== null) {
        running.abort();
        running = null;
        phase.value = { kind: 'idle' };
        if (released) {
          released = false;
          forgetTarget();
        }
      }
    },
    dismiss() {
      if (phase.peek().kind === 'error') {
        phase.value = { kind: 'idle' };
      }
    },
    release() {
      if (running !== null) {
        released = true;
        return;
      }
      forgetTarget();
      if (phase.peek().kind === 'error') {
        phase.value = { kind: 'idle' };
      }
    },
    stop() {
      running?.abort();
      running = null;
      released = false;
      phase.value = { kind: 'idle' };
      forgetTarget();
      leave();
    },
  };
}

function once<T>(get: () => T): () => T {
  let value: { v: T } | null = null;
  return () => (value ??= { v: get() }).v;
}

const states = new WeakMap<NoteSession, AiState>();

/** Ask AI's state for one note page. */
export function aiState(session: NoteSession): AiState {
  let state = states.get(session);
  if (state === undefined) {
    state = createAiState(
      {
        doc: session.doc,
        awareness: session.awareness,
        editor: session.editor,
        binding: session.binding,
        connection: session.connection,
        writable: () =>
          session.editor.isEditable() &&
          session.status.peek() === 'active' &&
          session.cap.peek() !== 'full',
        room: () => NOTE_MAX_BYTES - session.bytes.peek(),
      },
      { api: languageModel, personId: once(localPersonId), user: localUser },
    );
    states.set(session, state);
  }
  return state;
}
