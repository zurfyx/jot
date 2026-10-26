import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  signal,
} from '@lexical/extension';
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
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeBlame } from '../blame/attribution';
import { readRegistry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import { type AiState, createAiState, JOT_AI_NAME, MESSAGES } from './controller';
import type { LanguageModelApi, ModelAvailability, ModelCreateOptions } from './prompt-api';

/** The page's side: a synced document with two paragraphs, its editor and presence. */
function createHost() {
  const doc = new Y.Doc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/ai-host',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const awareness = new Awareness(doc);
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
  let writable = true;
  return {
    doc,
    editor,
    binding,
    awareness,
    connection: signal('connected'),
    writable: () => writable,
    setWritable(value: boolean) {
      writable = value;
    },
  };
}

type Host = ReturnType<typeof createHost>;

/** A fake Prompt API: records what it is asked, and answers with `reply`. */
function fakeModel(
  reply: (input: string, signal?: AbortSignal) => Promise<string>,
  availability: ModelAvailability = 'available',
) {
  const calls = { availability: 0, create: [] as ModelCreateOptions[], prompts: [] as string[] };
  let destroyed = 0;
  const api: LanguageModelApi = {
    availability() {
      calls.availability += 1;
      return Promise.resolve(availability);
    },
    create(options = {}) {
      calls.create.push(options);
      const monitor = new EventTarget();
      options.monitor?.(monitor);
      if (availability !== 'available') {
        const progress = new Event('downloadprogress') as Event & { loaded: number };
        progress.loaded = 0.5;
        monitor.dispatchEvent(progress);
      }
      return Promise.resolve({
        prompt(input, { signal } = {}) {
          calls.prompts.push(input);
          return reply(input, signal);
        },
        destroy() {
          destroyed += 1;
        },
      });
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

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function setup(api: LanguageModelApi | null, lingerMs?: number) {
  const host = createHost();
  const state = createAiState(host, {
    lingerMs,
    api: () => api,
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
    expect(state.targetInfo.value).toEqual({ blocks: 1, empty: false, problem: 'none' });
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
    // under its own client id, now registered as Gerard (the asker).
    expect(byName[JOT_AI_NAME]).toBeGreaterThan(0);
    expect(byName[JOT_AI_NAME]).toBeLessThan('and a '.length + 2);
    expect(byName.Gerard).toBeGreaterThan(20);
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
    expect(state.targetInfo.value).toEqual({ blocks: 1, empty: true, problem: 'none' });
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
    expect(state.availability.value).toBe('missing');
    caretInSecond(host, state);
    expect(await state.ask('Make it a list')).toBe(false);
    expect(state.phase.value).toEqual({ kind: 'error', message: MESSAGES.unavailable });

    const unavailable = fakeModel(() => Promise.resolve('x'), 'unavailable');
    const other = setup(unavailable.api);
    await other.state.refresh();
    expect(other.state.availability.value).toBe('unavailable');
    caretInSecond(other.host, other.state);
    expect(await other.state.ask('Make it a list')).toBe(false);
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
