/**
 * Ask AI (D21, D26): an instruction, applied by the chosen on-device model
 * (Chrome's built-in one, or a WebLLM model) to the
 * selected blocks (or the block with the caret), written into the note by
 * jot AI: an in-tab peer of its own (D20), so the edit reaches everyone
 * through the relay and blame names jot AI, asked by this person. It joins
 * once the model is ready and leaves a minute after its last request.
 *
 * Nothing leaves the page, and nothing is sent to the model unless the
 * person presses Ask. A WebLLM model downloads only after the person agrees
 * (the `consent` phase). One request at a time; `cancel` (Esc) stops it.
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
import { type AiBackend, type AiSession, ModelError } from './backend';
import { aiModels, type Resolved } from './choice';
import type { AiAvailability } from './prompt-api';

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
  unavailable: "This model can't run in this browser. Pick another in ⋯ → AI model.",
  noTarget:
    'Click in the note first: jot AI works on the selected blocks, or the one with the caret.',
  table: "jot AI can't rewrite tables yet. Select text outside the table.",
  tooLong: 'That is more text than the on-device model can take. Select fewer blocks.',
  cutOff: "jot AI's answer ran out of room in the model. Select fewer blocks.",
  load: "The model couldn't start on this device. Try again, or pick another in ⋯ → AI model.",
  readOnly: "This note can't be edited right now.",
  full: 'This note is too full for what jot AI wrote.',
  empty: 'jot AI had nothing to write. Try another instruction.',
  changed: 'The text changed while jot AI was thinking. Ask again.',
  modelChanged: 'The AI model changed since you agreed to the download. Ask again.',
  failed: "jot AI couldn't answer. Try again.",
} as const;

export type AiPhase =
  | { kind: 'idle' }
  /** A WebLLM model isn't here: the field asks before downloading it. */
  | { kind: 'consent'; model: string; size: string; ask: ConsentAsk }
  /** `loading`: from this browser's cache, not the network. */
  | { kind: 'downloading'; model: string; loading: boolean; progress: number | null }
  | { kind: 'thinking' }
  | { kind: 'error'; message: string };

/**
 * The download a consent question asked about: the model, its exact build and
 * its size. Download hands it back to `ask`, which goes on only if the model
 * it would use now is still that one.
 */
export interface ConsentAsk {
  id: string;
  build: string | null;
  bytes: number;
}

function consentAsk(backend: AiBackend): ConsentAsk {
  return { id: backend.id, build: backend.build ?? null, bytes: backend.consent?.bytes ?? 0 };
}

function sameConsent(a: ConsentAsk, b: ConsentAsk): boolean {
  return a.id === b.id && a.build === b.build && a.bytes === b.bytes;
}

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
  /** The model to use now (the AI model setting), or why none can run. */
  resolve(): Promise<Resolved>;
  /** A model finished loading. */
  onReady?(): void;
  personId(): string;
  user(): PeerUser;
  /** Defaults to AI_LINGER_MS. */
  lingerMs?: number;
}

/** The model a request would use, for the field. */
export interface AiModelView {
  name: string;
  /** Its download, when the person must agree to it first. */
  consent: { bytes: number; text: string } | null;
}

export interface AiState {
  availability: ReadonlySignal<AiAvailability | 'checking'>;
  /** The model the next request uses; null while checking or when none can run. */
  model: ReadonlySignal<AiModelView | null>;
  /** Why no model can run here, once checked. */
  reason: ReadonlySignal<string | null>;
  phase: ReadonlySignal<AiPhase>;
  /** The selection the next request applies to, as a Yjs cursor. */
  target: ReadonlySignal<YCursor | null>;
  targetInfo: ReadonlySignal<TargetInfo | null>;
  /** Counts the edits jot AI has written. */
  written: ReadonlySignal<number>;
  /** Asks the browser which model to use and whether it is there (local; sends nothing). */
  refresh(): Promise<void>;
  /** Takes the page's selection as the target of the next request (the field opened). */
  capture(): void;
  /**
   * Sends the instruction and the target to the model. Resolves true once
   * jot AI wrote. A WebLLM model that isn't here stops at the `consent`
   * phase; `consent` (from Download) lets it download, but only if it is
   * still the model, build and size the question named.
   */
  ask(instruction: string, options?: { consent?: ConsentAsk }): Promise<boolean>;
  /** Stops the running request, or declines a download; nothing is written. */
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
  const model = signal<AiModelView | null>(null);
  const reason = signal<string | null>(null);
  let backend: AiBackend | null = null;
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
    let resolved: Resolved;
    try {
      resolved = await deps.resolve();
    } catch {
      resolved = { backend: null, reason: MESSAGES.failed };
    }
    if (running !== null) {
      // A running request keeps the model it started with.
      return;
    }
    backend = resolved.backend;
    if (resolved.backend === null) {
      model.value = null;
      reason.value = resolved.reason;
      availability.value = 'unavailable';
      return;
    }
    const found = resolved.backend;
    reason.value = null;
    model.value = { name: found.name, consent: found.consent };
    let result: AiAvailability;
    try {
      result = await found.availability();
    } catch {
      result = 'unavailable';
    }
    if (running === null && backend === found) {
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

  const run = async (
    controller: AbortController,
    using: AiBackend,
    consented: boolean,
    cursor: YCursor,
    text: string,
  ): Promise<string | null | 'consent'> => {
    const { signal: abort } = controller;
    const check = () => {
      if (abort.aborted || running !== controller) {
        throw new Cancelled();
      }
    };
    let session: AiSession | null = null;
    try {
      try {
        session = await using.open({
          system: SYSTEM_PROMPT,
          signal: abort,
          consented,
          onProgress(progress, loading) {
            const now = phase.peek();
            if (running !== controller) {
              return;
            }
            if (now.kind === 'downloading') {
              phase.value = { ...now, progress, loading: loading ?? now.loading };
            } else if (now.kind === 'thinking') {
              // A model that is here loads from the cache before it thinks.
              phase.value = { kind: 'downloading', model: using.name, loading: true, progress };
            }
          },
        });
      } catch (error) {
        if (error instanceof ModelError && error.reason === 'consent') {
          return 'consent';
        }
        throw error;
      }
      check();
      availability.value = 'available';
      deps.onReady?.();
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
      if (read.markdown.length > Math.min(MAX_PASSAGE, using.maxPassage ?? Infinity)) {
        return MESSAGES.tooLong;
      }
      if (
        typeof session.measureInputUsage === 'function' &&
        typeof session.inputQuota === 'number'
      ) {
        const usage = await session.measureInputUsage(prompt, { signal: abort });
        check();
        if (usage > session.inputQuota - (session.inputUsage ?? 0)) {
          return MESSAGES.tooLong;
        }
      }

      const reply = await session.prompt(prompt, { signal: abort });
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
        session?.destroy();
      } catch {
        // Already gone.
      }
    }
  };

  return {
    availability,
    model,
    reason,
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
      // A question or an error from before belongs to a field that closed.
      const kind = phase.peek().kind;
      if (kind === 'error' || kind === 'consent') {
        phase.value = { kind: 'idle' };
      }
    },
    async ask(instruction, options = {}) {
      const text = instruction.trim();
      if (text === '' || running !== null) {
        return false;
      }
      const fail = (message: string) => {
        phase.value = { kind: 'error', message };
        return false;
      };
      // The setting may have changed since the field opened.
      await refresh();
      if (running !== null) {
        return false;
      }
      const status = availability.peek();
      const using = backend;
      if (using === null || status === 'missing' || status === 'unavailable') {
        return fail(reason.peek() ?? MESSAGES.unavailable);
      }
      // Consent is for one download: the model the question named, nothing else.
      const consented =
        options.consent !== undefined && sameConsent(options.consent, consentAsk(using));
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
        return fail(MESSAGES.table);
      }
      if (early.markdown.length > Math.min(MAX_PASSAGE, using.maxPassage ?? Infinity)) {
        return fail(MESSAGES.tooLong);
      }
      const question = (): AiPhase => ({
        kind: 'consent',
        model: using.name,
        size: using.consent?.text ?? '',
        ask: consentAsk(using),
      });
      const askFirst = (): false => {
        phase.value = question();
        return false;
      };
      if (using.consent !== null && status !== 'available' && !consented) {
        // Nothing downloads without a yes: the field asks first, and asks
        // again when the yes was for another model.
        return askFirst();
      }
      if (options.consent !== undefined && !consented) {
        // The yes was for a download this model doesn't need: nothing runs on it.
        return fail(MESSAGES.modelChanged);
      }

      const controller = new AbortController();
      running = controller;
      // A WebLLM model that is here still loads from the cache first.
      phase.value =
        status !== 'available'
          ? { kind: 'downloading', model: using.name, loading: false, progress: null }
          : using.consent === null
            ? { kind: 'thinking' }
            : { kind: 'downloading', model: using.name, loading: true, progress: null };
      let message: string | null | 'consent';
      try {
        message = await run(controller, using, consented, cursor, text);
      } catch (error) {
        if (error instanceof Cancelled || controller.signal.aborted) {
          // `cancel` set the phase; only a request still current resets it.
          settle(controller, { kind: 'idle' });
          return false;
        }
        if (error instanceof ModelError) {
          message =
            error.reason === 'too-long'
              ? MESSAGES.tooLong
              : error.reason === 'cut-off'
                ? MESSAGES.cutOff
                : MESSAGES.load;
        } else {
          console.warn('jot: Ask AI failed', error);
          message = MESSAGES.failed;
        }
      } finally {
        if (peer !== null && (running === null || running === controller)) {
          linger();
        }
      }
      if (message === 'consent') {
        // Some file went missing (evicted): ask before fetching it again, unless
        // the field closed meanwhile, which also forgets the target.
        if (running === controller) {
          availability.value = 'downloadable';
          settle(controller, released ? { kind: 'idle' } : question());
        }
        return false;
      }
      settle(controller, message === null ? { kind: 'idle' } : { kind: 'error', message });
      return message === null;
    },
    cancel() {
      if (running === null && phase.peek().kind === 'consent') {
        phase.value = { kind: 'idle' };
        return;
      }
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
      const kind = phase.peek().kind;
      if (kind === 'error' || kind === 'consent') {
        phase.value = { kind: 'idle' };
      }
    },
    release() {
      if (running !== null) {
        released = true;
        return;
      }
      forgetTarget();
      const kind = phase.peek().kind;
      if (kind === 'error' || kind === 'consent') {
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
      {
        resolve: () => aiModels().resolve(),
        onReady: () => void aiModels().refreshCache(),
        personId: once(localPersonId),
        user: localUser,
      },
    );
    states.set(session, state);
  }
  return state;
}
