import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  signal,
} from '@lexical/extension';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { YCollabExtension } from '@lexical/y';
import { Awareness } from '@y/protocols/awareness';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeBlame } from '../blame/attribution';
import { ownClientIds, readRegistry, writeEntry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import { type AiBackend, ModelError, promptApiBackend } from './backend';
import { type AiState, createAiState, JOT_AI_NAME, MESSAGES } from './controller';
import type { LanguageModelApi, ModelAvailability, ModelCreateOptions } from './prompt-api';

/**
 * The page's side: a synced document with two paragraphs (or, given `from`,
 * someone else's note as it is), its editor and presence.
 */
function createHost(from?: Y.Doc) {
  const doc = new Y.Doc();
  if (from !== undefined) {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  }
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/ai-host',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const awareness = new Awareness(doc);
  if (from === undefined) {
    seedTwoParagraphs(editor);
  }
  let writable = true;
  let room = Infinity;
  return {
    doc,
    editor,
    binding,
    awareness,
    connection: signal('connected'),
    writable: () => writable,
    room: () => room,
    setWritable(value: boolean) {
      writable = value;
    },
    setRoom(value: number) {
      room = value;
    },
  };
}

function seedTwoParagraphs(editor: LexicalEditor) {
  editor.update(
    () =>
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Plan')),
          $createParagraphNode().append($createTextNode('Demos, lunch, hack session')),
        ),
    { discrete: true },
  );
}

type Host = ReturnType<typeof createHost>;

/** A fake Prompt API: records what it is asked, and answers with `reply`. */
function fakeModel(
  reply: (input: string, signal?: AbortSignal) => Promise<string>,
  availability: ModelAvailability = 'available',
  extra: { gate?: Promise<void>; usage?: number; quota?: number } = {},
) {
  const calls = { availability: 0, create: [] as ModelCreateOptions[], prompts: [] as string[] };
  let destroyed = 0;
  const api: LanguageModelApi = {
    availability() {
      calls.availability += 1;
      return Promise.resolve(availability);
    },
    async create(options = {}) {
      calls.create.push(options);
      await extra.gate;
      const monitor = new EventTarget();
      options.monitor?.(monitor);
      if (availability !== 'available') {
        const progress = new Event('downloadprogress') as Event & { loaded: number };
        progress.loaded = 0.5;
        monitor.dispatchEvent(progress);
      }
      return {
        prompt(input: string, { signal }: { signal?: AbortSignal } = {}) {
          calls.prompts.push(input);
          return reply(input, signal);
        },
        ...(extra.quota === undefined
          ? {}
          : {
              inputQuota: extra.quota,
              inputUsage: 0,
              measureInputUsage: () => Promise.resolve(extra.usage ?? 0),
            }),
        destroy() {
          destroyed += 1;
        },
      };
    },
  };
  return { api, calls, destroyed: () => destroyed };
}

/** A reply that waits until it is aborted. */
function hanging(_input: string, signal?: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

/** localStorage, for the registry's record of this browser's own client ids. */
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const NO_MODEL = 'No model can run here.';

function setup(api: LanguageModelApi | AiBackend | null, lingerMs?: number, from?: Y.Doc) {
  const host = createHost(from);
  const backend = api === null || 'open' in api ? api : promptApiBackend(api);
  const state = createAiState(host, {
    lingerMs,
    resolve: () =>
      Promise.resolve(backend === null ? { backend: null, reason: NO_MODEL } : { backend }),
    personId: () => 'gerard-123',
    user: () => ({ name: 'Gerard', color: 0 }),
  });
  cleanups.push(() => {
    state.stop();
    host.awareness.destroy();
    host.editor.dispose();
    host.doc.destroy();
  });
  return { host, state };
}

/** Puts the page's caret in the second paragraph, and takes it as the target. */
function caretInSecond(host: Host, state: AiState) {
  host.editor.update(
    () => {
      $getRoot().getChildAtIndex<ElementNode>(1)!.getFirstDescendant()!.selectStart();
    },
    { discrete: true },
  );
  state.capture();
}

function texts(host: Host): string[] {
  return host.editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => `${node.getType()}:${node.getTextContent()}`),
  );
}

describe('Ask AI', () => {
  it('sends nothing until asked, then jot AI writes the reply as its own peer', async () => {
    const model = fakeModel(() => Promise.resolve('- Demos\n- Lunch\n- Hack session'));
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    expect(state.availability.value).toBe('available');
    expect(state.targetInfo.value).toEqual({
      blocks: 1,
      empty: false,
      list: false,
      problem: 'none',
    });
    expect(model.calls.create).toHaveLength(0);
    expect(model.calls.prompts).toHaveLength(0);

    expect(await state.ask('Make it a list')).toBe(true);
    expect(model.calls.prompts).toEqual([
      'Instruction: Make it a list\n\nPassage:\n<<<\nDemos, lunch, hack session\n>>>',
    ]);
    expect(model.calls.create[0]?.expectedInputs).toEqual([{ type: 'text', languages: ['en'] }]);
    expect(model.calls.create[0]?.initialPrompts?.[0]?.role).toBe('system');
    expect(model.destroyed()).toBe(1);
    expect(texts(host)).toEqual(['paragraph:Plan', 'list:Demos\n\nLunch\n\nHack session']);
    expect(state.phase.value).toEqual({ kind: 'idle' });
    expect(state.written.value).toBe(1);

    // jot AI is in the registry, asked by this person, who is there too.
    const { clients, people } = readRegistry(host.doc);
    expect(people.get('ai-gerard-123')).toMatchObject({
      name: JOT_AI_NAME,
      kind: 'ai',
      askedBy: 'gerard-123',
      color: 2,
    });
    expect(clients.get(host.doc.clientID)).toBe('gerard-123');
    // The list is written under jot AI's client id, not the page's.
    const aiClient = [...clients].find(([, person]) => person === 'ai-gerard-123')![0];
    const inserts = Y.createInsertSetFromStructStore(host.doc.store, false);
    expect(inserts.clients.has(aiClient)).toBe(true);
    // Its caret shows, named jot AI.
    expect(host.awareness.getStates().get(aiClient)).toMatchObject({
      user: { name: JOT_AI_NAME, color: 2 },
    });
  });

  it('is credited in blame with what it changed, the rest staying with its writer', async () => {
    const model = fakeModel(() => Promise.resolve('Demos, lunch and a hack session'));
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    expect(await state.ask('Add an "and"')).toBe(true);
    const { shares } = computeBlame(host.doc);
    const byName = Object.fromEntries(shares.map(({ person, chars }) => [person.name, chars]));
    // The page typed nothing itself in this test: its lines came from the setup,
    // under its own client id, now registered as Gerard (the asker). A rewrite
    // replaces whole words, so jot AI is credited with "lunch and a" alone.
    expect(byName[JOT_AI_NAME]).toBeGreaterThan(0);
    expect(byName[JOT_AI_NAME]).toBeLessThanOrEqual('lunch and a'.length);
    expect(byName.Gerard).toBeGreaterThan(20);
  });

  it("names its asker on someone else's note, before they have typed anything", async () => {
    // Ana's note, with her registry entry, as Gerard's page receives it.
    const ana = createHost();
    writeEntry(ana.doc, ana.doc.clientID, {
      personId: 'ana-456',
      name: 'Ana',
      color: 1,
      kind: 'person',
      seen: Math.floor(Date.now() / 1000),
    });
    cleanups.push(() => {
      ana.editor.dispose();
      ana.doc.destroy();
    });
    const model = fakeModel(() => Promise.resolve('Demos and lunch.'));
    const { host, state } = setup(model.api, undefined, ana.doc);
    await state.refresh();
    caretInSecond(host, state);
    expect(ownClientIds().has(host.doc.clientID)).toBe(false);
    expect(await state.ask('Shorter')).toBe(true);

    // The asker's session is this browser's own, so its tab reads it as "you".
    expect(ownClientIds().has(host.doc.clientID)).toBe(true);
    const { people } = readRegistry(host.doc, {
      personId: 'gerard-123',
      clients: ownClientIds(),
    });
    const ai = people.get('ai-gerard-123');
    expect(ai?.askedBy).toBe('gerard-123');
    expect(people.get(ai!.askedBy!)).toMatchObject({ name: 'Gerard', kind: 'person' });
    expect(people.get('ana-456')).toMatchObject({ name: 'Ana' });
  });

  it('says the whole list when the caret is in one of its items', () => {
    const { host, state } = setup(fakeModel(() => Promise.resolve('x')).api);
    host.editor.update(
      () => {
        const list = $createListNode('bullet').append(
          $createListItemNode().append($createTextNode('One')),
          $createListItemNode().append($createTextNode('Two')),
        );
        $getRoot().append(list);
        list.getLastDescendant()!.selectEnd();
      },
      { discrete: true },
    );
    state.capture();
    expect(state.targetInfo.value).toEqual({
      blocks: 1,
      empty: false,
      list: true,
      problem: 'none',
    });
  });

  it('writes nothing when a change Markdown cannot see happened meanwhile', async () => {
    let answer: (text: string) => void = () => undefined;
    const model = fakeModel(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const asked = state.ask('Make it a list');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    // Underline, which the Markdown sent to the model doesn't carry.
    host.editor.update(
      () => {
        const text = $getRoot().getChildAtIndex<ElementNode>(1)!.getFirstDescendant()!;
        (text as TextNode).toggleFormat('underline');
      },
      { discrete: true },
    );
    answer('- Demos');
    expect(await asked).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.changed });
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
  });

  it('joins the note only once the model is ready', async () => {
    let ready: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const model = fakeModel(() => Promise.resolve('Demos.'), 'downloadable', { gate });
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const asked = state.ask('Shorter');
    await vi.waitFor(() => expect(model.calls.create).toHaveLength(1));
    // Downloading: jot AI isn't on the note yet.
    expect(state.phase.value.kind).toBe('downloading');
    expect(host.awareness.getStates().size).toBe(1);
    ready();
    expect(await asked).toBe(true);
    expect(host.awareness.getStates().size).toBe(2);
  });

  it("a cancelled request doesn't reset a newer one", async () => {
    const model = fakeModel(hanging);
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const first = state.ask('One');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    state.cancel();
    const second = state.ask('Two');
    expect(await first).toBe(false);
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(2));
    expect(state.phase.value).toEqual({ kind: 'thinking' });
    state.cancel();
    expect(await second).toBe(false);
  });

  it('forgets the target when a request settles after the field closed', async () => {
    let fail: (error: Error) => void = () => undefined;
    const model = fakeModel((input, signal) =>
      input.includes('fail')
        ? new Promise<string>((_resolve, reject) => {
            fail = reject;
          })
        : hanging(input, signal),
    );
    const { host, state } = setup(model.api);
    await state.refresh();

    // Closed, then cancelled.
    caretInSecond(host, state);
    const cancelled = state.ask('Make it a list');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    state.release();
    expect(state.target.value).not.toBeNull();
    state.cancel();
    expect(await cancelled).toBe(false);
    expect(state.target.value).toBeNull();

    // Closed, then failed.
    caretInSecond(host, state);
    const failed = state.ask('fail please');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(2));
    state.release();
    fail(new Error('model crashed'));
    expect(await failed).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.failed });
    expect(state.target.value).toBeNull();
    expect(state.targetInfo.value).toBeNull();
  });

  it('refuses a reply the note has no room for, and a passage over the context window', async () => {
    const model = fakeModel(() => Promise.resolve('x'.repeat(5000)));
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    host.setRoom(4000);
    expect(await state.ask('Longer')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.full });
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');

    const small = fakeModel(() => Promise.resolve('y'), 'available', { usage: 900, quota: 500 });
    const other = setup(small.api);
    await other.state.refresh();
    caretInSecond(other.host, other.state);
    expect(await other.state.ask('Shorter')).toBe(false);
    expect(other.state.phase.value).toEqual({ kind: 'error', message: MESSAGES.tooLong });
    expect(small.calls.prompts).toHaveLength(0);
  });

  it('writes into an empty block', async () => {
    const model = fakeModel(() => Promise.resolve('```markdown\n# Lunch spots\n```'));
    const { host, state } = setup(model.api);
    host.editor.update(
      () => {
        const empty = $createParagraphNode();
        $getRoot().append(empty);
        empty.select();
      },
      { discrete: true },
    );
    state.capture();
    expect(state.targetInfo.value).toEqual({
      blocks: 1,
      empty: true,
      list: false,
      problem: 'none',
    });
    expect(await state.ask('A heading for lunch')).toBe(true);
    expect(model.calls.prompts[0]).toContain('<<<\n\n>>>');
    expect(texts(host)).toEqual([
      'paragraph:Plan',
      'paragraph:Demos, lunch, hack session',
      'heading:Lunch spots',
    ]);
  });

  it('explains when the model is not there, and sends nothing', async () => {
    const { host, state } = setup(null);
    await state.refresh();
    expect(state.availability.value).toBe('unavailable');
    expect(state.reason.value).toBe(NO_MODEL);
    expect(state.model.value).toBeNull();
    caretInSecond(host, state);
    expect(await state.ask('Make it a list')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: NO_MODEL });

    const unavailable = fakeModel(() => Promise.resolve('x'), 'unavailable');
    const other = setup(unavailable.api);
    await other.state.refresh();
    expect(other.state.availability.value).toBe('unavailable');
    caretInSecond(other.host, other.state);
    expect(await other.state.ask('Make it a list')).toBe(false);
    expect(other.state.phase.value).toEqual({ kind: 'error', message: MESSAGES.unavailable });
    expect(unavailable.calls.create).toHaveLength(0);
    expect(readRegistry(other.host.doc).people.size).toBe(0);
  });

  it('shows the download, then answers', async () => {
    const model = fakeModel(() => Promise.resolve('Demos and lunch.'), 'downloadable');
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const phases: string[] = [];
    state.phase.subscribe((phase) =>
      phases.push(phase.kind === 'downloading' ? `downloading:${phase.progress}` : phase.kind),
    );
    expect(await state.ask('Shorter')).toBe(true);
    expect(phases).toEqual(['idle', 'downloading:null', 'downloading:0.5', 'thinking', 'idle']);
    expect(state.availability.value).toBe('available');
  });

  it('runs one request at a time, and cancelling writes nothing', async () => {
    const model = fakeModel(hanging);
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const first = state.ask('Make it a list');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    expect(state.phase.value).toEqual({ kind: 'thinking' });
    expect(await state.ask('Again')).toBe(false);

    state.cancel();
    expect(await first).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'idle' });
    expect(texts(host)).toEqual(['paragraph:Plan', 'paragraph:Demos, lunch, hack session']);
    // jot AI only showed its caret: the note holds no registry entry for anyone.
    expect(readRegistry(host.doc).people.size).toBe(0);
    expect(model.destroyed()).toBe(1);
  });

  it('writes nothing when the text changed while the model was thinking', async () => {
    let answer: (text: string) => void = () => undefined;
    const model = fakeModel(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const asked = state.ask('Make it a list');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    host.editor.update(
      () => {
        $getRoot().getChildAtIndex<ElementNode>(1)!.selectEnd().insertText(', snacks');
      },
      { discrete: true },
    );
    answer('- Demos');
    expect(await asked).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.changed });
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session, snacks');
  });

  it('refuses without a target, on a read-only note, and with an empty reply', async () => {
    const model = fakeModel(() => Promise.resolve('   '));
    const { host, state } = setup(model.api);
    await state.refresh();
    expect(await state.ask('Make it a list')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.noTarget });

    caretInSecond(host, state);
    expect(state.phase.value).toEqual({ kind: 'idle' });
    host.setWritable(false);
    expect(await state.ask('Make it a list')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.readOnly });

    host.setWritable(true);
    expect(await state.ask('Make it a list')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.empty });
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
  });

  it('leaves the note a while after writing, and comes back under a new client id', async () => {
    const model = fakeModel((input) =>
      Promise.resolve(input.includes('Demos.') ? 'Demos!' : 'Demos.'),
    );
    const { host, state } = setup(model.api, 30);
    await state.refresh();
    caretInSecond(host, state);
    await state.ask('Shorter');
    const aiClients = () =>
      [...readRegistry(host.doc).clients]
        .filter(([, person]) => person === 'ai-gerard-123')
        .map(([client]) => client);
    expect(aiClients()).toHaveLength(1);
    expect(host.awareness.getStates().size).toBe(2);
    await vi.waitFor(() => expect(host.awareness.getStates().size).toBe(1));
    expect(texts(host)[1]).toBe('paragraph:Demos.');

    caretInSecond(host, state);
    expect(await state.ask('Louder')).toBe(true);
    expect(texts(host)[1]).toBe('paragraph:Demos!');
    expect(aiClients()).toHaveLength(2);
    // One person in blame, whatever its client ids.
    expect(computeBlame(host.doc).shares.filter(({ person }) => person.kind === 'ai')).toHaveLength(
      1,
    );
  });

  it('writes nothing when the note turns read only while the model thinks', async () => {
    let answer: (text: string) => void = () => undefined;
    const model = fakeModel(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    const asked = state.ask('Make it a list');
    await vi.waitFor(() => expect(model.calls.prompts).toHaveLength(1));
    host.setWritable(false);
    answer('- Demos');
    expect(await asked).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.readOnly });
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
    expect(readRegistry(host.doc).people.size).toBe(0);
  });

  it("leaves the note when the page closes; jot AI's writes stay", async () => {
    const model = fakeModel(() => Promise.resolve('Demos.'));
    const { host, state } = setup(model.api);
    await state.refresh();
    caretInSecond(host, state);
    await state.ask('Shorter');
    expect(host.awareness.getStates().size).toBe(2);
    state.stop();
    expect(host.awareness.getStates().size).toBe(1);
    expect(texts(host)[1]).toBe('paragraph:Demos.');
  });
});

/**
 * A backend shaped like a WebLLM model: a download the person must agree to,
 * a cache that may have lost it, and a passage limit of its own.
 */
function fakeDownloadable(options: {
  here?: boolean;
  /** jot remembers the download, but the cache lost it. */
  evicted?: boolean;
  reply?: (input: string, signal?: AbortSignal) => Promise<string>;
  maxPassage?: number;
  fail?: ModelError;
  /** The download waits until it is aborted. */
  hang?: boolean;
}) {
  let here = options.here ?? false;
  const calls = { open: [] as boolean[], prompts: [] as string[] };
  const backend: AiBackend = {
    id: 'small',
    name: 'Qwen2.5 0.5B',
    consent: { bytes: 295_000_000, text: '300 MB' },
    maxPassage: options.maxPassage,
    availability: () => Promise.resolve(here || options.evicted ? 'available' : 'downloadable'),
    async open({ consented, onProgress, signal }) {
      calls.open.push(consented);
      if (options.evicted && !consented) {
        throw new ModelError('consent');
      }
      if (!here) {
        onProgress(0.25);
        await (options.hang
          ? new Promise((_resolve, reject) =>
              signal.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              ),
            )
          : Promise.resolve());
        signal.throwIfAborted();
        onProgress(1);
        here = true;
      }
      if (options.fail?.reason === 'load') {
        throw options.fail;
      }
      return {
        prompt(input, { signal: promptSignal } = {}) {
          calls.prompts.push(input);
          if (options.fail !== undefined) {
            return Promise.reject(options.fail);
          }
          return (options.reply ?? (() => Promise.resolve('Demos.')))(input, promptSignal);
        },
        destroy() {},
      };
    },
  };
  return { backend, calls };
}

describe('Ask AI with a model to download', () => {
  it('asks before downloading, and downloads nothing on Not now', async () => {
    const model = fakeDownloadable({});
    const { host, state } = setup(model.backend);
    await state.refresh();
    expect(state.model.value).toEqual({
      name: 'Qwen2.5 0.5B',
      consent: { bytes: 295_000_000, text: '300 MB' },
    });
    expect(state.availability.value).toBe('downloadable');
    caretInSecond(host, state);
    expect(await state.ask('Shorter')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'consent', model: 'Qwen2.5 0.5B', size: '300 MB' });
    expect(model.calls.open).toEqual([]);
    state.cancel();
    expect(state.phase.value).toEqual({ kind: 'idle' });
    expect(model.calls.open).toEqual([]);
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
  });

  it('downloads after a yes, with progress, then jot AI writes', async () => {
    const model = fakeDownloadable({});
    const { host, state } = setup(model.backend);
    await state.refresh();
    caretInSecond(host, state);
    await state.ask('Shorter');
    const phases: string[] = [];
    state.phase.subscribe((phase) =>
      phases.push(
        phase.kind === 'downloading'
          ? `${phase.loading ? 'loading' : 'downloading'}:${phase.progress}`
          : phase.kind,
      ),
    );
    expect(await state.ask('Shorter', { consented: true })).toBe(true);
    expect(model.calls.open).toEqual([true]);
    expect(phases).toEqual([
      'consent',
      'downloading:null',
      'downloading:0.25',
      'downloading:1',
      'thinking',
      'idle',
    ]);
    expect(texts(host)[1]).toBe('paragraph:Demos.');
    expect(state.availability.value).toBe('available');

    // Downloaded: the next Ask goes straight to the model.
    caretInSecond(host, state);
    expect(await state.ask('Shorter')).toBe(true);
    expect(model.calls.open).toEqual([true, false]);
  });

  it('asks again when the browser evicted a download it had', async () => {
    const model = fakeDownloadable({ evicted: true });
    const { host, state } = setup(model.backend);
    await state.refresh();
    expect(state.availability.value).toBe('available');
    caretInSecond(host, state);
    expect(await state.ask('Shorter')).toBe(false);
    expect(model.calls.open).toEqual([false]);
    expect(state.phase.value).toEqual({ kind: 'consent', model: 'Qwen2.5 0.5B', size: '300 MB' });
    expect(state.availability.value).toBe('downloadable');
    // jot AI never joined.
    expect(host.awareness.getStates().size).toBe(1);
  });

  it("refuses a passage over the model's own limit, before anything is sent", async () => {
    const model = fakeDownloadable({ here: true, maxPassage: 10 });
    const { host, state } = setup(model.backend);
    await state.refresh();
    caretInSecond(host, state);
    expect(await state.ask('Shorter')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.tooLong });
    expect(model.calls.open).toEqual([]);
  });

  it('writes nothing when the reply was cut off, or the model could not load', async () => {
    for (const [reason, message] of [
      ['cut-off', MESSAGES.cutOff],
      ['too-long', MESSAGES.tooLong],
      ['load', MESSAGES.load],
    ] as const) {
      const model = fakeDownloadable({ here: true, fail: new ModelError(reason) });
      const { host, state } = setup(model.backend);
      await state.refresh();
      caretInSecond(host, state);
      expect(await state.ask('Shorter')).toBe(false);
      expect(state.phase.value).toEqual({ kind: 'error', message });
      expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
      expect(readRegistry(host.doc).people.size).toBe(0);
    }
  });

  it('Esc during the download stops it, and nothing is written', async () => {
    const model = fakeDownloadable({ hang: true });
    const { host, state } = setup(model.backend);
    await state.refresh();
    caretInSecond(host, state);
    const asked = state.ask('Shorter', { consented: true });
    await vi.waitFor(() =>
      expect(state.phase.value).toMatchObject({ kind: 'downloading', progress: 0.25 }),
    );
    state.cancel();
    expect(await asked).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'idle' });
    expect(model.calls.prompts).toEqual([]);
    expect(texts(host)[1]).toBe('paragraph:Demos, lunch, hack session');
  });
});
