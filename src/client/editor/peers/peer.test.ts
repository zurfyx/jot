import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  signal,
} from '@lexical/extension';
import { YCollabExtension } from '@lexical/y';
import { Awareness } from '@y/protocols/awareness';
import * as Y from '@y/y';
import { $createParagraphNode, $getRoot, configExtension, defineExtension } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { readRegistry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';
import { createInTabPeer, type InTabPeer, type PeerPerson } from './peer';

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
  const doc = new Y.Doc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/host',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const awareness = new Awareness(doc);
  const connection = signal('connected');
  // A page's editor holds an empty paragraph once it has a root element.
  editor.update(() => $getRoot().clear().append($createParagraphNode()), { discrete: true });
  return { doc, editor, binding, awareness, connection };
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
    host.doc.on('update', () => hostUpdates++);
    ana.edit(() => {
      $getRoot().getFirstChildOrThrow().selectEnd().insertText(', world');
    });
    expect(hostText(host)).toBe('Hello, world');
    // One update for the peer's write: nothing bounced back.
    expect(hostUpdates).toBe(1);

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

    ana.dispose();
    expect(state()).toBeUndefined();
    // Its writes stay.
    expect(hostText(host)).toBe('Plan');
  });

  it('announce themselves again when the note reconnects', () => {
    const { host, join } = setup();
    const ana = join(ANA);
    const clock = () => host.awareness.meta.get(ana.doc.clientID)?.clock ?? -1;
    const before = clock();
    host.connection.value = 'offline';
    host.connection.value = 'connected';
    expect(clock()).toBeGreaterThan(before);
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
