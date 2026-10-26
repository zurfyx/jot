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
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExampleFlag } from '../../examples';
import { readRegistry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import type { NoteSession } from '../session';
import { EXAMPLE } from './content';
import { createExampleState, type ExampleDeps } from './controller';

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A note page as the controller sees it: synced or not, writable or not. */
function fakeSession(id = 'AAAAAAAAAAAAAAAAAAAAAA', from: Y.Doc | null = null) {
  const doc = new Y.Doc();
  if (from !== null) {
    // Another tab on the same note: it starts from what the relay holds.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  }
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/page',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  if (from === null) {
    editor.update(() => $getRoot().clear().append($createParagraphNode()), { discrete: true });
  }
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const awareness = new Awareness(doc);
  const session = {
    noteId: signal<string | null>(id),
    doc,
    awareness,
    editor,
    binding,
    status: signal('active'),
    everSynced: signal(true),
    cap: signal('ok'),
    connection: signal('connected'),
    link: () => `https://jot.rovira.sh/n/${id}`,
  };
  cleanups.push(() => {
    awareness.destroy();
    editor.dispose();
    doc.destroy();
  });
  const text = () => editor.getEditorState().read(() => $getRoot().getTextContent());
  return { session, asNote: session as unknown as NoteSession, text };
}

/** Web Locks for one browser: a name is held by one tab at a time; others wait. */
function fakeLocks() {
  const held = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  const lock = (name: string, granted: () => Promise<void>, signal: AbortSignal) => {
    const grant = () => {
      held.add(name);
      void granted().finally(() => {
        held.delete(name);
        queues.get(name)?.shift()?.();
      });
    };
    if (!held.has(name)) {
      grant();
      return;
    }
    const queue = queues.get(name) ?? [];
    queues.set(name, queue);
    const waiting = () => {
      if (!signal.aborted) {
        grant();
      } else {
        queue.shift()?.();
      }
    };
    queue.push(waiting);
  };
  return lock;
}

function fakeDeps(overrides: Partial<ExampleDeps> = {}) {
  const flags = new Map<string, ExampleFlag>();
  const adopted: string[] = [];
  const deps: ExampleDeps = {
    isCreator: () => true,
    readFlag: (id) => flags.get(id) ?? 'new',
    writeFlag: (id, flag) => flags.set(id, flag),
    adopt: (id) => adopted.push(id),
    lock: fakeLocks(),
    instant: () => true,
    ...overrides,
  };
  return { deps, flags, adopted };
}

/** Lets the queued join and the instant script run. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function demoNames(session: { awareness: Awareness }): string[] {
  return [...session.awareness.getStates().values()]
    .map((state) => (state.user as { name?: string } | undefined)?.name ?? '')
    .filter((name) => name.endsWith('(demo)'))
    .sort();
}

function plans(text: string): number {
  return text.split(EXAMPLE.title).length - 1;
}

describe('the example controller', () => {
  it('seeds an empty note once, marks it played, moves to its link and plays', async () => {
    const { session, asNote, text } = fakeSession();
    const { deps, flags, adopted } = fakeDeps();
    const state = createExampleState(asNote, deps);
    const stop = state.start();
    await settle();
    expect(state.active.value).toBe(true);
    expect(plans(text())).toBe(1);
    expect(text()).toContain('Afternoon: hack session');
    expect(text()).toContain(EXAMPLE.anaTodo);
    expect(flags.get(session.noteId.value!)).toBe('played');
    expect(adopted).toEqual([session.noteId.value]);
    expect(demoNames(session)).toEqual(['Ana (demo)', 'jot AI (demo)']);
    stop();
    expect(demoNames(session)).toEqual([]);
    expect(state.active.value).toBe(false);
  });

  it('never seeds a note that has content', async () => {
    const { session, asNote, text } = fakeSession();
    session.editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('Already here')));
      },
      { discrete: true },
    );
    const state = createExampleState(asNote, fakeDeps().deps);
    cleanups.push(state.start());
    await settle();
    expect(text()).toBe('Already here');
  });

  it('brings the collaborators back idle on a played example, writing nothing', async () => {
    const { session, asNote, text } = fakeSession();
    const { deps, flags } = fakeDeps();
    const first = createExampleState(asNote, deps);
    const stopFirst = first.start();
    await settle();
    const played = text();
    const demoIds = () =>
      [...session.awareness.getStates().keys()].filter(
        (clientID) => clientID !== session.doc.clientID,
      );
    const ids = demoIds();
    const entries = readRegistry(session.doc).clients.size;
    const state = Y.encodeStateVector(session.doc);
    stopFirst();

    expect(flags.get(session.noteId.value!)).toBe('played');
    const again = createExampleState(asNote, deps);
    cleanups.push(again.start());
    await settle();
    expect(demoNames(session)).toEqual(['Ana (demo)', 'jot AI (demo)']);
    expect(text()).toBe(played);
    // New client ids, never reused; idle carets add nothing to the note.
    for (const clientID of demoIds()) {
      expect(ids).not.toContain(clientID);
    }
    expect(readRegistry(session.doc).clients.size).toBe(entries);
    expect(Y.encodeStateVector(session.doc)).toEqual(state);
  });

  it('waits for the first sync and a writable note, rechecked when the queued join runs', async () => {
    const { session, asNote, text } = fakeSession();
    session.everSynced.value = false;
    session.status.value = 'pending';
    const state = createExampleState(asNote, fakeDeps().deps);
    cleanups.push(state.start());
    await settle();
    expect(demoNames(session)).toEqual([]);

    session.status.value = 'active';
    session.everSynced.value = true;
    // The join is queued; the note fills up before it runs.
    session.cap.value = 'full';
    await settle();
    expect(demoNames(session)).toEqual([]);
    expect(text()).toBe('');
    expect(state.writable.value).toBe(false);

    session.cap.value = 'warn';
    await settle();
    expect(plans(text())).toBe(1);
  });

  for (const [what, change] of [
    ['turns full', (s: ReturnType<typeof fakeSession>['session']) => (s.cap.value = 'full')],
    [
      'turns read only',
      (s: ReturnType<typeof fakeSession>['session']) => (s.status.value = 'readonly'),
    ],
  ] as const) {
    it(`stops the script when the note ${what}`, async () => {
      vi.useFakeTimers();
      const { session, asNote, text } = fakeSession();
      const state = createExampleState(asNote, fakeDeps({ instant: () => false }).deps);
      cleanups.push(state.start());
      await vi.advanceTimersByTimeAsync(10);
      expect(plans(text())).toBe(1);
      expect(state.playing.value).toBe(true);

      change(session);
      expect(state.playing.value).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(text()).not.toContain(EXAMPLE.anaTodo);
      expect(text()).not.toContain('Afternoon');

      // Replay does nothing while the note can't take edits.
      state.replay();
      expect(state.playing.value).toBe(false);
    });
  }

  it('runs in one tab only: a duplicated tab with the same flag stays out', async () => {
    const locks = fakeLocks();
    const a = fakeSession();
    const b = fakeSession(undefined, a.session.doc);
    // Two tabs on one note: their documents sync (as through the relay).
    a.session.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'b') Y.applyUpdate(b.session.doc, update, 'a');
    });
    b.session.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'a') Y.applyUpdate(a.session.doc, update, 'b');
    });
    const first = createExampleState(a.asNote, fakeDeps({ lock: locks }).deps);
    const second = createExampleState(b.asNote, fakeDeps({ lock: locks }).deps);
    const stopFirst = first.start();
    cleanups.push(second.start());
    await settle();
    expect(first.active.value).toBe(true);
    expect(second.active.value).toBe(false);
    expect(plans(a.text())).toBe(1);
    expect(plans(b.text())).toBe(1);
    expect(demoNames(a.session)).toEqual(['Ana (demo)', 'jot AI (demo)']);
    expect(demoNames(b.session)).toEqual([]);

    // When the first tab closes, the second takes over, idle.
    stopFirst();
    await settle();
    expect(second.active.value).toBe(true);
    expect(demoNames(b.session)).toEqual(['Ana (demo)', 'jot AI (demo)']);
    expect(plans(b.text())).toBe(1);
  });

  it('survives a remount that asks for the lock before the first release lands', async () => {
    const { session, asNote, text } = fakeSession();
    const state = createExampleState(asNote, fakeDeps().deps);
    // React Strict Mode: mount, unmount, mount.
    state.start()();
    cleanups.push(state.start());
    await settle();
    expect(state.active.value).toBe(true);
    expect(plans(text())).toBe(1);
    expect(demoNames(session)).toEqual(['Ana (demo)', 'jot AI (demo)']);
  });

  it('never doubles the plan when two creators both saw an empty note', async () => {
    const a = fakeSession();
    const b = fakeSession();
    // Separate locks (two browsers would not share one), both synced empty.
    const first = createExampleState(a.asNote, fakeDeps().deps);
    const second = createExampleState(b.asNote, fakeDeps().deps);
    const stopFirst = first.start();
    await settle();
    // The second page's copy of the note arrives before its demo joins.
    Y.applyUpdate(b.session.doc, Y.encodeStateAsUpdate(a.session.doc));
    cleanups.push(second.start());
    await settle();
    expect(plans(b.text())).toBe(1);
    stopFirst();
  });
});
