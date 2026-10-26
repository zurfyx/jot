import * as Y from '@y/y';

/**
 * One entry per Yjs client id, in a second root beside 'lexical-y'. The keys
 * are short because the registry counts towards the note's size.
 */
export function register(doc: Y.Doc, person: { id: string; name: string; color: number }) {
  doc.get('jot-people').setAttr(String(doc.clientID), {
    p: person.id,
    n: person.name,
    c: person.color,
    k: 'person',
    s: Math.floor(Date.now() / 1000),
  });
}

/** Client id to person id, for the content map. Every entry is a stranger's input. */
export function clientsToPeople(doc: Y.Doc): Map<number, string> {
  const clients = new Map<number, string>();
  for (const [key, value] of doc.get('jot-people').attrEntries() as Iterable<[string, unknown]>) {
    const person = (value as { p?: unknown } | null)?.p;
    if (Number.isSafeInteger(Number(key)) && typeof person === 'string') {
      clients.set(Number(key), person);
    }
  }
  return clients;
}
