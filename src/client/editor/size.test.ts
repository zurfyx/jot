import * as Y from '@y/y';
import { describe, expect, it } from 'vitest';

import { compactedSize } from './size';

describe('compactedSize', () => {
  it('counts what the relay would store, not content an undo stack keeps alive', () => {
    const doc = new Y.Doc();
    const text = doc.get('lexical-y');
    const undo = new Y.UndoManager(text);
    const passage = 'a long passage '.repeat(10_000);
    for (let i = 0; i < 4; i++) {
      doc.transact(() => {
        text.delete(0, text.length);
        text.insert(0, passage + i);
      });
      undo.stopCapturing();
    }
    const raw = Y.encodeStateAsUpdate(doc).byteLength;
    const server = new Y.Doc({ gc: true });
    server.cleanupFormatting = false;
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    const stored = Y.encodeStateAsUpdate(server).byteLength;

    expect(raw).toBeGreaterThan(3 * passage.length);
    expect(compactedSize(doc)).toBe(stored);
    expect(compactedSize(doc)).toBeLessThan(passage.length * 1.1);
  });

  it('matches the encoded size of a document without deletions', () => {
    const doc = new Y.Doc();
    doc.get('lexical-y').insert(0, 'hello');
    expect(compactedSize(doc)).toBe(Y.encodeStateAsUpdate(doc).byteLength);
  });
});
