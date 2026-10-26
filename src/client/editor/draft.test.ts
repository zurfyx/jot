import * as Y from '@y/y';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  draftStateAddsTo,
  encodeDraftState,
  mergedDraftState,
  moveDraft,
  parseDraft,
  pendingStorageKey,
  readDraft,
  removeDraft,
  removeDraftIfUnchanged,
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

describe('stored copies against a document', () => {
  it('adds nothing when the document already holds it', () => {
    const doc = new Y.Doc();
    doc.get('lexical-y').insert(0, 'same');
    expect(draftStateAddsTo(doc, encodeDraftState(doc))).toBe(false);
  });

  it('adds newer inserts and deletes', () => {
    const doc = new Y.Doc();
    doc.get('lexical-y').insert(0, 'older');
    const newer = new Y.Doc();
    Y.applyUpdate(newer, Y.encodeStateAsUpdate(doc));
    newer.get('lexical-y').insert(5, ' LATEST');
    expect(draftStateAddsTo(doc, encodeDraftState(newer))).toBe(true);

    const deleted = new Y.Doc();
    Y.applyUpdate(deleted, Y.encodeStateAsUpdate(doc));
    deleted.get('lexical-y').delete(0, 1);
    expect(draftStateAddsTo(doc, encodeDraftState(deleted))).toBe(true);
    // Checking leaves the document alone.
    expect(doc.get('lexical-y').toString()).toBe('older');
  });

  it('merges a write with the same draft stored by another page, never another draft', () => {
    const base = new Y.Doc();
    base.get('lexical-y').insert(0, 'base');
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(base));
    other.get('lexical-y').insert(4, ' other');
    const mine = new Y.Doc();
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(base));
    mine.get('lexical-y').insert(0, 'mine ');

    const stored = { id: 'd', state: encodeDraftState(other) };
    const merged = new Y.Doc();
    restoreDraftState(merged, mergedDraftState(mine, stored, 'd'));
    expect(merged.get('lexical-y').toString()).toContain('mine');
    expect(merged.get('lexical-y').toString()).toContain('other');

    const alone = new Y.Doc();
    restoreDraftState(alone, mergedDraftState(mine, stored, 'another draft'));
    expect(alone.get('lexical-y').toString()).not.toContain('other');
  });
});

describe('draft storage', () => {
  const store = new Map<string, string>();
  /** Total characters the fake storage holds, like a browser's quota. */
  let quota = Infinity;
  beforeEach(() => {
    store.clear();
    quota = Infinity;
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        let used = value.length;
        for (const [k, v] of store) {
          used += k === key ? 0 : v.length;
        }
        if (used > quota) {
          throw new DOMException('full', 'QuotaExceededError');
        }
        store.set(key, value);
      },
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

  it('removes a copy only while it is exactly what was checked', () => {
    writeDraft('k', { id: 'd', state: 'old' });
    const checked = store.get('k')!;
    writeDraft('k', { id: 'd', state: 'newer' });
    removeDraftIfUnchanged('k', checked);
    expect(readDraft('k')?.state).toBe('newer');
    removeDraftIfUnchanged('k', store.get('k')!);
    expect(readDraft('k')).toBeNull();
  });

  it('moves a draft, keeping one copy when there is room for only one', () => {
    const draft = { id: 'd', state: 'x'.repeat(100) };
    writeDraft('jot:draft', draft);
    quota = 180;
    expect(moveDraft('jot:draft', 'jot:pending:a', draft)).toBe(true);
    expect(readDraft('jot:draft')).toBeNull();
    expect(readDraft('jot:pending:a')).toEqual(draft);
  });

  it('keeps the draft where it was when the copy cannot be stored at all', () => {
    const draft = { id: 'd', state: 'x'.repeat(100) };
    writeDraft('jot:draft', draft);
    quota = 140;
    const bigger = { id: 'd', state: 'x'.repeat(130) };
    expect(moveDraft('jot:draft', 'jot:pending:a', bigger)).toBe(false);
    expect(readDraft('jot:draft')).toEqual(draft);
    expect(readDraft('jot:pending:a')).toBeNull();
  });

  it('keeps pending copies per note', () => {
    writeDraft(pendingStorageKey('a'), { id: 'd', state: 's' });
    expect(readDraft(pendingStorageKey('b'))).toBeNull();
    expect(readDraft(pendingStorageKey('a'))).toEqual({ id: 'd', state: 's' });
  });
});
