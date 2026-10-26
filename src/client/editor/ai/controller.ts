/**
 * Ask AI (D21): an instruction, applied by Chrome's built-in model to the
 * selected blocks (or the block with the caret), written into the note by
 * jot AI: an in-tab peer of its own (D20), so the edit reaches everyone
 * through the relay and blame names jot AI, asked by this person. It joins
 * for a request and leaves a minute after it.
 *
 * Nothing leaves the page, and nothing is sent to the model unless the
 * person presses Ask. One request at a time; `cancel` (Esc) stops it.
 */
import { type ReadonlySignal, signal } from '@lexical/extension';
import type { YBinding, YCursor } from '@lexical/y';
import type { Awareness } from '@y/protocols/awareness';
import type * as Y from '@y/y';
import type { LexicalEditor } from 'lexical';

import { localPersonId, readRegistry, writeEntry } from '../blame/registry';
import { createInTabPeer, type InTabPeer, type PeerPerson } from '../peers/peer';
import { localUser, type PeerUser } from '../presence';
import type { NoteSession } from '../session';
import {
  $blocksToMarkdown,
  $replaceBlocks,
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
 * the note (a peer reconciles a second editor on every change; D20).
 */
export const AI_LINGER_MS = 60_000;

export const MESSAGES = {
  unavailable: "Needs Chrome's built-in AI (Gemini Nano). Open jot in Chrome on desktop.",
  noTarget:
    'Click in the note first: jot AI works on the selected blocks, or the one with the caret.',
  table: "jot AI can't rewrite tables yet. Select text outside the table.",
  tooLong: 'That is more text than the on-device model can take. Select fewer blocks.',
  readOnly: "This note can't be edited right now.",
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
  problem: Target['problem'];
}

/** The page's side of a note, as jot AI needs it. */
export interface AiHost {
  doc: Y.Doc;
  awareness: Awareness;
  editor: LexicalEditor;
  binding: YBinding;
  connection?: ReadonlySignal<string>;
  /** The note takes edits now (editable, and not full). */
  writable(): boolean;
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
  /** Takes the page's selection as the target of the next request. */
  capture(): void;
  /** Sends the instruction and the target to the model. Resolves true once jot AI wrote. */
  ask(instruction: string): Promise<boolean>;
  /** Stops the running request; nothing is written. */
  cancel(): void;
  /** Clears an error. */
  dismiss(): void;
  /** The field closed: forgets the target, unless a request is running on it. */
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

  const fail = (message: string) => {
    phase.value = { kind: 'error', message };
    return false;
  };

  /** The target as the page's editor has it now. */
  const readTarget = (cursor: YCursor) =>
    host.editor.getEditorState().read(() => {
      const points = host.binding.$resolveCursor(cursor);
      const found = points === null ? null : $targetBetween(points.anchor, points.focus);
      if (found === null) {
        return null;
      }
      return {
        problem: found.problem,
        blocks: found.blocks.length,
        empty: found.blocks.length === 1 && found.blocks[0]!.getTextContent().trim() === '',
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

  /** Blame's "asked by" needs the asker in the registry, even before they type. */
  const registerAsker = () => {
    const { doc } = host;
    if (!readRegistry(doc).clients.has(doc.clientID)) {
      const { name, color } = deps.user();
      writeEntry(doc, doc.clientID, {
        personId: deps.personId(),
        name,
        color,
        kind: 'person',
        seen: Math.floor(Date.now() / 1000),
      });
    }
  };

  const refresh = async () => {
    const result = await checkAvailability(deps.api());
    // A download that started meanwhile knows better.
    if (running === null || result === 'available') {
      availability.value = result;
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
        return;
      }
      const cursor = host.binding.getCursor();
      target.value = cursor;
      let info: TargetInfo | null = null;
      if (cursor !== null) {
        try {
          const read = readTarget(cursor);
          info = read && { blocks: read.blocks, empty: read.empty, problem: read.problem };
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
      if (availability.peek() === 'checking') {
        await refresh();
      }
      const status = availability.peek();
      const api = deps.api();
      if (api === null || status === 'missing' || status === 'unavailable') {
        return fail(MESSAGES.unavailable);
      }
      const cursor = target.peek();
      if (cursor === null) {
        return fail(MESSAGES.noTarget);
      }
      if (!host.writable()) {
        return fail(MESSAGES.readOnly);
      }
      const sent = readTarget(cursor);
      if (sent === null) {
        return fail(MESSAGES.noTarget);
      }
      if (sent.problem !== 'none') {
        return fail(MESSAGES.table);
      }
      if (sent.markdown.length > MAX_PASSAGE) {
        return fail(MESSAGES.tooLong);
      }

      const controller = new AbortController();
      const { signal: abort } = controller;
      running = controller;
      phase.value =
        status === 'available' ? { kind: 'thinking' } : { kind: 'downloading', progress: null };
      const check = () => {
        if (abort.aborted) {
          throw new Cancelled();
        }
      };

      let model: ModelSession | null = null;
      try {
        const ai = joinPeer();
        // jot AI's caret goes to the blocks it is working on (a selection: nothing is written).
        ai.edit(() => {
          const points = ai.binding.$resolveCursor(cursor);
          const found = points && $targetBetween(points.anchor, points.focus);
          found?.blocks[0]?.selectStart();
        });

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
        const reply = await model.prompt(buildPrompt(text, sent.markdown), { signal: abort });
        check();

        const markdown = cleanReply(reply);
        if (markdown === '') {
          return fail(MESSAGES.empty);
        }
        if (!host.writable()) {
          return fail(MESSAGES.readOnly);
        }
        let outcome: 'written' | 'gone' | 'changed' | 'empty' = 'gone';
        const ok = ai.edit(() => {
          const points = ai.binding.$resolveCursor(cursor);
          const found = points && $targetBetween(points.anchor, points.focus);
          if (found === null || found.problem !== 'none') {
            outcome = 'gone';
            return;
          }
          if ($blocksToMarkdown(found.blocks) !== sent.markdown) {
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
          return fail(MESSAGES.failed);
        }
        switch (outcome as 'written' | 'gone' | 'changed' | 'empty') {
          case 'written':
            registerAsker();
            written.value += 1;
            target.value = null;
            targetInfo.value = null;
            phase.value = { kind: 'idle' };
            return true;
          case 'empty':
            return fail(MESSAGES.empty);
          case 'gone':
          case 'changed':
            return fail(MESSAGES.changed);
        }
      } catch (error) {
        if (abort.aborted) {
          phase.value = { kind: 'idle' };
          return false;
        }
        console.warn('jot: Ask AI failed', error);
        return fail(MESSAGES.failed);
      } finally {
        try {
          model?.destroy();
        } catch {
          // Already gone.
        }
        if (running === controller) {
          running = null;
        }
        if (peer !== null && running === null) {
          linger();
        }
      }
    },
    cancel() {
      if (running !== null) {
        running.abort();
        running = null;
        phase.value = { kind: 'idle' };
      }
    },
    dismiss() {
      if (phase.peek().kind === 'error') {
        phase.value = { kind: 'idle' };
      }
    },
    release() {
      if (running === null) {
        target.value = null;
        targetInfo.value = null;
        if (phase.peek().kind === 'error') {
          phase.value = { kind: 'idle' };
        }
      }
    },
    stop() {
      running?.abort();
      running = null;
      phase.value = { kind: 'idle' };
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
        writable: () => session.editor.isEditable() && session.cap.peek() !== 'full',
      },
      { api: languageModel, personId: once(localPersonId), user: localUser },
    );
    states.set(session, state);
  }
  return state;
}
