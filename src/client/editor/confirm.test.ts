import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';

import { excludeServerState, unconfirmedDocument } from './confirm';

describe('excludeServerState', () => {
  it('confirms inserts the server already has, and keeps the rest', () => {
    const doc = new Y.Doc();
    const text = doc.get('lexical-y');
    text.insert(0, 'on the server');
    const server = Y.decodeStateVector(Y.encodeStateVector(doc));
    const before = unconfirmedDocument(doc);
    expect(excludeServerState([before], server)).toEqual([]);

    text.insert(0, 'written offline ');
    const after = unconfirmedDocument(doc);
    const left = excludeServerState([after], server);
    expect(left).toHaveLength(1);
    expect(left[0]!.ids.inserts.isEmpty()).toBe(false);
  });

  it('keeps deletes, which a state vector does not describe', () => {
    const doc = new Y.Doc();
    const text = doc.get('lexical-y');
    text.insert(0, 'abc');
    const server = Y.decodeStateVector(Y.encodeStateVector(doc));
    text.delete(0, 1);
    const left = excludeServerState([unconfirmedDocument(doc)], server);
    expect(left).toHaveLength(1);
    expect(left[0]!.ids.inserts.isEmpty()).toBe(true);
    expect(left[0]!.ids.deletes.isEmpty()).toBe(false);
  });
});
