import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  signal,
} from '@lexical/extension';
import { createYDoc, YCollabExtension } from '@lexical/y';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate as encodeStates,
  removeAwarenessStates,
} from '@y/protocols/awareness';
import * as Y from '@y/y';
import { $createParagraphNode, $getRoot, configExtension, defineExtension } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeAwarenessUpdate } from '../../../worker/awareness';

import { readRegistry, SEEN_REFRESH_MS } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import { createInTabPeer, type InTabPeer, type PeerPerson } from './peer';
import { SCHEMA_VERSION } from '../../../shared/schema';

const ANA: PeerPerson = { personId: 'demo-ana', name: 'Ana (demo)', color: 1, kind: 'demo' };
const AI: PeerPerson = {
  personId: 'demo-ai',
  name: 'jot AI',
  color: 2,
  kind: 'ai',
  askedBy: 'gerard',
};

/** The page's side: a synced document, its editor and its presence. */
function createHost() {
  const doc = createYDoc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/host',
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, { doc, schemaVersion: SCHEMA_VERSION, synced: true }),
      ],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const awareness = new Awareness(doc);
  const connection = signal('connected');
  const status = signal('active');
  const cap = signal('ok');
  // A page's editor holds an empty paragraph once it has a root element.
  editor.update(() => $getRoot().clear().append($createParagraphNode()), { discrete: true });
  return { doc, editor, binding, awareness, connection, status, cap };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function setup() {
  const host = createHost();
  const peers: InTabPeer[] = [];
  const join = (person: PeerPerson) => {
    const peer = createInTabPeer(host, person);
    peers.push(peer);
    return peer;
  };
  cleanups.push(() => {
    for (const peer of peers) {
      peer.dispose();
    }
    host.awareness.destroy();
    host.editor.dispose();
    host.doc.destroy();
  });
  return { host, join };
}

function hostText(host: ReturnType<typeof createHost>): string {
  return host.editor.getEditorState().read(() => $getRoot().getTextContent());
}

describe('in-tab peers', () => {
  it('start from the note and sync both ways, without echoing', () => {
    const { host, join } = setup();
    host.editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd().insertText('Hello'), {
      discrete: true,
    });
    const ana = join(ANA);
    expect(ana.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('Hello');

    let hostUpdates = 0;
    let peerUpdates = 0;
    host.doc.on('update', () => hostUpdates++);
    ana.doc.on('update', () => peerUpdates++);
    ana.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText(', world');
    });
    expect(hostText(host)).toBe('Hello, world');
    // The text, then the peer's registry entry: each reaches the host once,
    // and nothing bounces back into the peer.
    expect(peerUpdates).toBe(2);
    expect(hostUpdates).toBe(2);

    host.editor.update(() => $getRoot().getLastChildOrThrow().selectEnd().insertText('!'), {
      discrete: true,
    });
    expect(ana.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
      'Hello, world!',
    );
  });

  it('write with their own client id, named in the registry', () => {
    const { host, join } = setup();
    const ana = join(ANA);
    const ai = join(AI);
    expect(ana.doc.clientID).not.toBe(host.doc.clientID);
    expect(ana.doc.clientID).not.toBe(ai.doc.clientID);
    ai.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText('Drafted');
    });
    ana.edit(() => {
      $getRoot().getFirstChildOrThrow().selectStart().insertText('Ana: ');
    });
    const { clients, people } = readRegistry(host.doc);
    expect(clients.get(ana.doc.clientID)).toBe('demo-ana');
    expect(clients.get(ai.doc.clientID)).toBe('demo-ai');
    expect(people.get('demo-ana')).toMatchObject({ name: 'Ana (demo)', color: 1, kind: 'demo' });
    expect(people.get('demo-ai')).toMatchObject({ kind: 'ai', askedBy: 'gerard' });
    // The inserted text is the AI's client's.
    const inserts = Y.createInsertSetFromStructStore(host.doc.store, false);
    expect(inserts.clients.has(ai.doc.clientID)).toBe(true);
  });

  it("relay their presence and caret into the note's awareness", () => {
    const { host, join } = setup();
    const ana = join(ANA);
    const state = () => host.awareness.getStates().get(ana.doc.clientID);
    expect(state()).toMatchObject({ user: { name: 'Ana (demo)', color: 1 }, cursor: null });

    ana.edit(() => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      paragraph.selectEnd().insertText('Plan');
    });
    const cursor: unknown = state()?.cursor;
    expect(cursor).not.toBeNull();
    // The host resolves the peer's caret against its own document.
    const offset = host.editor
      .getEditorState()
      .read(() => host.binding.$resolveCursor(cursor as never)?.focus.offset);
    expect(offset).toBe(4);

    const listeners = () =>
      (host.doc as unknown as { _observers: Map<string, Set<unknown>> })._observers.get('update')
        ?.size ?? 0;
    const before = listeners();
    ana.dispose();
    expect(state()).toBeUndefined();
    // Its writes stay, and it no longer follows the note.
    expect(hostText(host)).toBe('Plan');
    expect(listeners()).toBe(before - 1);
    host.editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd().insertText('!'), {
      discrete: true,
    });
  });

  it('come back after the page drops remote presence on disconnect', () => {
    const { host, join } = setup();
    const ana = join(ANA);
    // What the provider does when its socket closes.
    removeAwarenessStates(host.awareness, [ana.doc.clientID], 'provider');
    expect(host.awareness.getStates().has(ana.doc.clientID)).toBe(false);
    host.connection.value = 'offline';
    host.connection.value = 'connected';
    expect(host.awareness.getStates().get(ana.doc.clientID)).toMatchObject({
      user: { name: 'Ana (demo)' },
    });
  });

  it("stay visible to other clients after the relay announced the page's departure", () => {
    const { host, join } = setup();
    const ana = join(ANA);
    // Another client on the note, fed what the page's provider sends.
    const other = new Awareness(new Y.Doc());
    cleanups.push(() => other.destroy());
    const forward = ({ added, updated, removed }: Record<string, number[]>) => {
      const changed = [...added!, ...updated!, ...removed!];
      applyAwarenessUpdate(other, encodeStates(host.awareness, changed), 'relay');
    };
    host.awareness.on('update', forward);
    ana.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText('Hi');
    });
    expect(other.getStates().get(ana.doc.clientID)).toBeDefined();

    // The socket closes: the relay removes the page's states one clock past
    // the last it saw, and every other client keeps that clock.
    const seen = host.awareness.meta.get(ana.doc.clientID)!.clock;
    applyAwarenessUpdate(
      other,
      encodeAwarenessUpdate([{ clientID: ana.doc.clientID, clock: seen + 1, state: 'null' }]),
      'relay',
    );
    removeAwarenessStates(host.awareness, [ana.doc.clientID], 'provider');
    expect(other.getStates().has(ana.doc.clientID)).toBe(false);

    host.connection.value = 'offline';
    host.connection.value = 'connected';
    expect(other.getStates().get(ana.doc.clientID)).toMatchObject({
      user: { name: 'Ana (demo)' },
    });
    host.awareness.off('update', forward);
  });

  it('write only while the note takes edits', () => {
    const { host, join } = setup();
    const ana = join(ANA);
    const write = (text: string) =>
      ana.edit(() => {
        $getRoot().getFirstChildOrThrow().selectEnd().insertText(text);
      });
    expect(write('a')).toBe(true);
    host.status.value = 'readonly';
    expect(ana.writable()).toBe(false);
    expect(write('b')).toBe(false);
    host.status.value = 'active';
    host.cap.value = 'full';
    expect(write('c')).toBe(false);
    host.cap.value = 'warn';
    expect(write('d')).toBe(true);
    expect(hostText(host)).toBe('ad');

    // An explicit check wins over status and cap.
    const gated = createInTabPeer({ ...host, writable: () => false }, AI);
    cleanups.push(() => gated.dispose());
    expect(gated.edit(() => $getRoot().clear())).toBe(false);
    expect(hostText(host)).toBe('ad');
  });

  it('refresh their last-seen time while editing, at most every ten minutes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    cleanups.push(() => vi.useRealTimers());
    vi.setSystemTime(1_000_000_000_000);
    const { host, join } = setup();
    const ana = join(ANA);
    const seen = () => readRegistry(host.doc).people.get('demo-ana')?.seen;
    const write = () =>
      ana.edit(() => {
        $getRoot().getFirstChildOrThrow().selectEnd().insertText('x');
      });
    expect(seen()).toBeUndefined();
    write();
    const start = seen();
    expect(start).toBe(1_000_000_000);
    vi.setSystemTime(1_000_000_000_000 + 60_000);
    write();
    expect(seen()).toBe(start);
    vi.setSystemTime(1_000_000_000_000 + SEEN_REFRESH_MS + 1000);
    write();
    expect(seen()).toBe(start! + Math.floor((SEEN_REFRESH_MS + 1000) / 1000));
  });

  it('get a new client id every time, and a registry entry only once they edit', () => {
    const { host, join } = setup();
    const first = join(ANA);
    first.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText('one');
    });
    const firstId = first.doc.clientID;
    first.dispose();

    // A re-created peer (a reload) never reuses the id.
    const again = join(ANA);
    expect(again.doc.clientID).not.toBe(firstId);
    expect(again.doc.clientID).not.toBe(host.doc.clientID);
    // Only showing its caret writes nothing to the note.
    const before = Y.encodeStateVector(host.doc);
    again.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd();
    });
    expect(Y.encodeStateVector(host.doc)).toEqual(before);
    expect(readRegistry(host.doc).clients.has(again.doc.clientID)).toBe(false);

    // Its first change names it, under the same person as before.
    again.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText(' two');
    });
    expect(hostText(host)).toBe('one two');
    const { clients, people } = readRegistry(host.doc);
    expect(clients.get(firstId)).toBe('demo-ana');
    expect(clients.get(again.doc.clientID)).toBe('demo-ana');
    expect(people.size).toBe(1);
  });

  it('never throw from an edit', () => {
    const { join } = setup();
    const ana = join(ANA);
    expect(
      ana.edit(() => {
        throw new Error('boom');
      }),
    ).toBe(false);
    ana.dispose();
    expect(ana.edit(() => $getRoot().append())).toBe(false);
    expect(() => ana.dispose()).not.toThrow();
  });
});
