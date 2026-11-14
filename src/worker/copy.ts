/**
 * The fresh-document fallback's copy (D34, design section 6): a note's
 * migrated state rebuilt as new Yjs items, with Yjs types only (no Lexical,
 * so the Worker stays Yjs-only). Every live item of every top-level type is
 * copied as it is, in order, under the new document's own client id:
 * strings, embeds, format items (their keys and values unchanged: layout 4's
 * ends name keys, not ids) and nested types, and every live attribute.
 * Deleted items and tombstones are not copied, so the copy is the state
 * without its history. Every id changes: relative positions, blame
 * attribution and derived block ids do not carry over.
 */
import * as Y from '@y/y';

import { createYDoc } from './library';

type Container = Y.Node;

function copyContainer(tr: Y.Transaction, from: Container, to: Container): void {
  const doc = tr.doc;
  const nextId = () => Y.createID(doc.clientID, doc.store.getClock(doc.clientID));
  let left: Y.Item | null = null;
  for (let it = from._start; it !== null; it = it.right) {
    if (it.deleted) {
      continue;
    }
    const content = it.content.copy();
    const item: Y.Item = new Y.Item(
      nextId(),
      left,
      left === null ? null : left.lastId,
      null,
      null,
      to,
      null,
      content,
    );
    item.integrate(tr, 0);
    if (it.content instanceof Y.ContentType) {
      copyContainer(tr, it.content.type as Container, (content as Y.ContentType).type as Container);
    }
    left = item;
  }
  for (const [key, it] of from._map) {
    if (it.deleted) {
      continue;
    }
    const content = it.content.copy();
    const item = new Y.Item(nextId(), null, null, null, null, to, key, content);
    item.integrate(tr, 0);
    if (it.content instanceof Y.ContentType) {
      copyContainer(tr, it.content.type as Container, (content as Y.ContentType).type as Container);
    }
  }
}

/** A copy of `state` without its history: every live item, new ids. */
export function freshCopy(state: Uint8Array): Uint8Array {
  const from = createYDoc(state, { gc: true });
  const to = createYDoc(null, { gc: true });
  try {
    to.transact((tr) => {
      for (const [name, type] of from.share) {
        copyContainer(tr, type as Container, to.get(name));
      }
    });
    return Y.encodeStateAsUpdate(to);
  } finally {
    from.destroy();
    to.destroy();
  }
}
