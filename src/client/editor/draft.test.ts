import * as Y from '@y/y';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  encodeDraftState,
  parseDraft,
  pendingStorageKey,
  readDraft,
  removeDraft,
  restoreDraftState,
  writeDraft,
} from './draft';

describe('draft state', () => {
  it('round-trips a document through the stored string', () => {
    const doc = new Y.Doc();
    const root = doc.get('lexical-y');
    root.insert(0, 'Plan for Thursday');
    root.delete(0, 5);
    const restored = new Y.Doc();
    expect(restoreDraftState(restored, encodeDraftState(doc))).toBe(true);
    expect(restored.get('lexical-y').toString()).toBe(root.toString());
  });

  it('encodes documents larger than one string chunk', () => {
    const doc = new Y.Doc();
    doc.get('lexical-y').insert(0, 'x'.repeat(200_000));
    const restored = new Y.Doc();
    expect(restoreDraftState(restored, encodeDraftState(doc))).toBe(true);
    expect(restored.get('lexical-y').toString().length).toBe(200_000);
  });

  it('ignores an unreadable state', () => {
    expect(restoreDraftState(new Y.Doc(), '')).toBe(false);
    expect(restoreDraftState(new Y.Doc(), 'not base64 !!')).toBe(false);
    expect(restoreDraftState(new Y.Doc(), btoa('\u0001\u0002\u0003'))).toBe(false);
  });

  it('parses only stored drafts', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('AAE=')).toBeNull();
    expect(parseDraft('{"id":1,"state":"x"}')).toBeNull();
    expect(parseDraft('{"id":"a","state":"x"}')).toEqual({ id: 'a', state: 'x' });
  });
});

describe('draft storage', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as Storage;
  });
  afterEach(() => {
    // @ts-expect-error: Node has no localStorage of its own.
    delete globalThis.localStorage;
  });

  it('removes a draft only while it is still the same draft', () => {
    writeDraft('jot:draft', { id: 'mine', state: 's1' });
    // Another tab stores its own draft over it.
    writeDraft('jot:draft', { id: 'theirs', state: 's2' });
    removeDraft('jot:draft', 'mine');
    expect(readDraft('jot:draft')).toEqual({ id: 'theirs', state: 's2' });
    removeDraft('jot:draft', 'theirs');
    expect(readDraft('jot:draft')).toBeNull();
  });

  it('keeps pending copies per note', () => {
    writeDraft(pendingStorageKey('a'), { id: 'd', state: 's' });
    expect(readDraft(pendingStorageKey('b'))).toBeNull();
    expect(readDraft(pendingStorageKey('a'))).toEqual({ id: 'd', state: 's' });
  });
});
