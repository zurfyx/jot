import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';

import { copyAddsTo, legacyCopyIds, parseLegacyCopy } from './legacy';

function stored(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  return JSON.stringify({ id: 'draft', state: btoa(String.fromCharCode(...update)) });
}

describe('parseLegacyCopy', () => {
  it('reads the Yjs update an earlier version stored', () => {
    const doc = new Y.Doc();
    doc.get('lexical-y').insert(0, 'Plan for Thursday');
    const update = parseLegacyCopy(stored(doc));
    expect(update).not.toBeNull();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, update!);
    expect(restored.get('lexical-y').toString()).toBe(doc.get('lexical-y').toString());
  });

  it('is null for nothing, other JSON, bad base64 or a non-update', () => {
    expect(parseLegacyCopy(null)).toBeNull();
    expect(parseLegacyCopy('not json')).toBeNull();
    expect(parseLegacyCopy('{"id":"x"}')).toBeNull();
    expect(parseLegacyCopy('{"id":"x","state":""}')).toBeNull();
    expect(parseLegacyCopy('{"id":"x","state":"%%%"}')).toBeNull();
    expect(parseLegacyCopy(JSON.stringify({ id: 'x', state: btoa('\xff\xff\xff') }))).toBeNull();
  });
});

describe('legacyCopyIds', () => {
  it('lists the note ids with a pending copy, and nothing else', () => {
    const items = new Map([
      ['jot:pending:abc', '1'],
      ['jot:draft', '2'],
      ['jot:theme', 'dark'],
      ['jot:pending:def', '3'],
    ]);
    const keys = [...items.keys()];
    const storage = { length: keys.length, key: (i: number) => keys[i] ?? null } as Storage;
    expect(legacyCopyIds(storage)).toEqual(['abc', 'def']);
  });
});

describe('copyAddsTo', () => {
  const state = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);

  it('is false for a copy the server holds, deletions included', () => {
    const server = new Y.Doc();
    const text = server.get('lexical-y');
    text.insert(0, 'Hello world');
    text.delete(5, 6);
    const copy = state(server);
    text.insert(5, ' again');
    expect(copyAddsTo(state(server), copy)).toBe(false);
  });

  it('is false against a server that has collected the deleted content', () => {
    const page = new Y.Doc({ gc: false });
    page.get('lexical-y').insert(0, 'Hello world');
    page.get('lexical-y').delete(5, 6);
    const server = new Y.Doc({ gc: true });
    Y.applyUpdate(server, state(page));
    expect(copyAddsTo(state(server), state(page))).toBe(false);
  });

  it('is true for a copy with an insert or a deletion the server lacks', () => {
    const server = new Y.Doc();
    server.get('lexical-y').insert(0, 'Hello world');
    const page = new Y.Doc();
    Y.applyUpdate(page, state(server));
    page.get('lexical-y').delete(0, 6);
    expect(copyAddsTo(state(server), state(page))).toBe(true);
    const typed = new Y.Doc();
    Y.applyUpdate(typed, state(server));
    typed.get('lexical-y').insert(11, '!');
    expect(copyAddsTo(state(server), state(typed))).toBe(true);
  });
});
