import * as Y from '@y/y';

/** An entry of `WebsocketProvider#unconfirmedUpdates`. */
export interface Unconfirmed {
  ids: Y.ContentIds;
  created: number;
}

/**
 * Drops from `unconfirmed` every insert the server's state vector already
 * covers. The relay echoes each update it applies, which confirms most local
 * content; but content another client wrote first under the same derived
 * client id (the binding's seed and repairs) changes nothing on the server
 * and is never echoed. The server's sync step 1 covers it.
 */
export function excludeServerState(
  unconfirmed: Unconfirmed[],
  stateVector: Map<number, number>,
): Unconfirmed[] {
  const known = Y.createIdSet();
  for (const [client, clock] of stateVector) {
    known.add(client, 0, clock);
  }
  const covered = Y.createContentIds(known, Y.createIdSet());
  return unconfirmed.filter((entry) => {
    entry.ids = Y.excludeContentIds(entry.ids, covered);
    return !entry.ids.inserts.isEmpty() || !entry.ids.deletes.isEmpty();
  });
}

/** The content of a whole document, as unconfirmed by the server. */
export function unconfirmedDocument(doc: Y.Doc): Unconfirmed {
  return {
    ids: Y.createContentIdsFromUpdate(Y.encodeStateAsUpdate(doc)),
    // Older than the provider's 500 ms merge window, so later edits get
    // entries of their own.
    created: Date.now() - 1000,
  };
}
