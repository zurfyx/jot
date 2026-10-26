import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';

import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';

import { buildContentMap } from '../../client/editor/blame/attribution';
import { createPeer } from './ai-peer';
import { editApartThenMerge } from './merge';
import { clientsToPeople, register } from './registry';
import { appendLine, seedNote, toMarkdown } from './server-edit';

// The docs show these files as they are; these tests keep what they claim true.

describe('the merge snippet', () => {
  it('ends with the same text on both sides, both edits kept', () => {
    const [you, ana] = editApartThenMerge();
    expect(you).toBe(ana);
    expect(you).toBe('Friday: Bring snacks. And plates.');
  });
});

describe('the server-side editing snippet', () => {
  it('seeds identically twice, appends a line and reads Markdown', () => {
    const seed = seedNote('Offsite');
    expect(seedNote('Offsite')).toEqual(seed);
    const { update, state } = appendLine(seed, 'Bring snacks.');
    expect(update).not.toBeNull();
    expect(toMarkdown(state)).toBe('# Offsite\n\nBring snacks.');

    // The update is what a relay would apply and broadcast.
    const live = new Y.Doc();
    Y.applyUpdate(live, seed);
    Y.applyUpdate(live, update!);
    expect(toMarkdown(Y.encodeStateAsUpdate(live))).toBe('# Offsite\n\nBring snacks.');
  });
});

describe('the registry snippet', () => {
  it("maps each client to its person, and jot's content map attributes their runs", () => {
    const you = new Y.Doc();
    const ana = new Y.Doc();
    register(you, { id: 'you', name: 'You', color: 0 });
    you.get('lexical-y').insert(0, 'Hello ');
    Y.applyUpdate(ana, Y.encodeStateAsUpdate(you));
    register(ana, { id: 'ana', name: 'Ana', color: 1 });
    ana.get('lexical-y').insert(6, 'world');
    Y.applyUpdate(you, Y.encodeStateAsUpdate(ana));

    const clients = clientsToPeople(you);
    expect(clients).toEqual(
      new Map([
        [you.clientID, 'you'],
        [ana.clientID, 'ana'],
      ]),
    );
    const renderer = Y.createAttributionsRenderer(buildContentMap(you, clients));
    const delta = you.get('lexical-y').toDelta({ renderer });
    const runs = (JSON.parse(JSON.stringify(delta)) as { children: unknown[] }).children;
    expect(runs).toEqual([
      expect.objectContaining({ insert: 'Hello ', attribution: { insert: ['you'] } }),
      expect.objectContaining({ insert: 'world', attribution: { insert: ['ana'] } }),
    ]);
  });
});

describe('the in-tab peer snippet', () => {
  it("writes into the note as its own client, and follows the note's changes", () => {
    const note = new Y.Doc();
    const seed = seedNote('Plan');
    Y.applyUpdate(note, seed);
    const peer = createPeer(note);
    expect(peer.doc.clientID).not.toBe(note.clientID);

    peer.edit(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('From the peer')));
    });
    const inserted = Y.createInsertSetFromStructStore(note.store, true);
    expect(inserted.clients.has(peer.doc.clientID)).toBe(true);
    expect(toMarkdown(Y.encodeStateAsUpdate(note))).toBe('# Plan\n\nFrom the peer');

    // Someone else's edit reaches the peer, and nothing echoes back.
    const { update } = appendLine(Y.encodeStateAsUpdate(note), 'From the relay');
    Y.applyUpdate(note, update!);
    expect(toMarkdown(Y.encodeStateAsUpdate(peer.doc))).toBe(
      '# Plan\n\nFrom the peer\n\nFrom the relay',
    );
    peer.dispose();
  });
});
