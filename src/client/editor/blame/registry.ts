/**
 * The people registry: a second root in the note's Y.Doc (PEOPLE_ROOT) that
 * maps Yjs client ids to people, so blame can name who wrote what. Yjs gives
 * every tab a new client id; the registry maps each of them to a stable
 * person, and blame groups by person.
 *
 * One attribute per client id, its value a small object with short keys
 * (it counts towards the note's 2 MB):
 *   p: person id · n: name · c: colour index · k: kind · a: asked by (person id, AI only) · s: last seen (Unix seconds)
 *
 * Everything read from it is untrusted input from strangers.
 */
import * as Y from '@y/y';

import { PEOPLE_ROOT } from '../../../shared/protocol';
import { PEER_COLORS, type PeerUser } from '../presence';

export type PersonKind = 'person' | 'demo' | 'ai';

export interface RegistryEntry {
  personId: string;
  name: string;
  color: number;
  kind: PersonKind;
  /** For AI: the person id of who asked. */
  askedBy?: string;
  /** Unix seconds. */
  seen: number;
}

/** A person, merged over all their client ids. */
export interface BlamePerson {
  id: string;
  name: string;
  color: number;
  kind: PersonKind;
  askedBy?: string;
  /** Unix seconds; the latest over their client ids. */
  seen: number;
}

/** Origin of the registry's own transactions. */
export const REGISTRY_ORIGIN = 'jot-people';

/** `seen` is refreshed at most this often while editing. */
export const SEEN_REFRESH_MS = 60_000;

const PERSON_ID_KEY = 'jot:person';
const MAX_NAME = 40;
const MAX_ID = 32;

export function peopleRoot(doc: Y.Doc): Y.Node {
  return doc.get(PEOPLE_ROOT);
}

/** This browser's stable person id. */
export function localPersonId(): string {
  try {
    const stored = localStorage.getItem(PERSON_ID_KEY);
    if (stored !== null && /^[\w-]{8,32}$/.test(stored)) {
      return stored;
    }
  } catch {
    // Private mode: a new person per page.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  try {
    localStorage.setItem(PERSON_ID_KEY, id);
  } catch {
    // As above.
  }
  return id;
}

function isKind(value: unknown): value is PersonKind {
  return value === 'person' || value === 'demo' || value === 'ai';
}

/** One registry value, defensively. */
export function parseEntry(value: unknown): RegistryEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { p, n, c, k, a, s } = value as Record<string, unknown>;
  if (typeof p !== 'string' || p === '' || typeof n !== 'string') {
    return null;
  }
  const color =
    typeof c === 'number' && Number.isFinite(c) ? Math.abs(Math.trunc(c)) % PEER_COLORS : 0;
  const entry: RegistryEntry = {
    personId: p.slice(0, MAX_ID),
    name: n.trim().slice(0, MAX_NAME) || 'Someone',
    color,
    kind: isKind(k) ? k : 'person',
    seen: typeof s === 'number' && Number.isFinite(s) ? s : 0,
  };
  if (entry.kind === 'ai' && typeof a === 'string' && a !== '') {
    entry.askedBy = a.slice(0, MAX_ID);
  }
  return entry;
}

function encodeEntry(entry: RegistryEntry): Record<string, string | number> {
  const value: Record<string, string | number> = {
    p: entry.personId,
    n: entry.name.slice(0, MAX_NAME),
    c: entry.color,
    k: entry.kind,
    s: entry.seen,
  };
  if (entry.askedBy !== undefined) {
    value.a = entry.askedBy;
  }
  return value;
}

/** Writes the entry for `clientID` (PR "example" and PR "ai" write their peers' too). */
export function writeEntry(doc: Y.Doc, clientID: number, entry: RegistryEntry): void {
  doc.transact(() => {
    peopleRoot(doc).setAttr(String(clientID), encodeEntry(entry));
  }, REGISTRY_ORIGIN);
}

export interface Registry {
  /** Client id to person id. */
  clients: Map<number, string>;
  /** Person id to person. */
  people: Map<string, BlamePerson>;
}

/** Reads the registry. Never throws. */
export function readRegistry(doc: Y.Doc): Registry {
  const clients = new Map<number, string>();
  const people = new Map<string, BlamePerson>();
  try {
    for (const [key, value] of peopleRoot(doc).attrEntries() as Iterable<[unknown, unknown]>) {
      const clientID = Number(key);
      const entry = parseEntry(value);
      if (!Number.isSafeInteger(clientID) || clientID < 0 || entry === null) {
        continue;
      }
      clients.set(clientID, entry.personId);
      const known = people.get(entry.personId);
      // The newest entry names the person (they may have renamed since).
      if (known === undefined || entry.seen >= known.seen) {
        people.set(entry.personId, {
          id: entry.personId,
          name: entry.name,
          color: entry.color,
          kind: entry.kind,
          askedBy: entry.askedBy,
          seen: entry.seen,
        });
      }
    }
  } catch {
    // A registry blame cannot read names nobody.
  }
  return { clients, people };
}

/**
 * Keeps this session's entry: written on its first edit, and `seen`
 * refreshed at most once a minute while editing. Viewing alone writes
 * nothing, so a visit does not grow the note. The check per transaction is a
 * couple of comparisons.
 */
export function trackLocalPerson(
  doc: Y.Doc,
  user: () => PeerUser,
  personId: string = localPersonId(),
): () => void {
  let writtenFor = -1;
  let writtenAt = 0;
  let queued = false;
  let stopped = false;
  const write = () => {
    queued = false;
    if (stopped) {
      return;
    }
    const { name, color } = user();
    writtenFor = doc.clientID;
    writtenAt = Date.now();
    try {
      writeEntry(doc, doc.clientID, {
        personId,
        name,
        color,
        kind: 'person',
        seen: Math.floor(writtenAt / 1000),
      });
    } catch {
      // Never let blame break editing.
    }
  };
  const onTransaction = (tr: Y.Transaction) => {
    if (
      queued ||
      !tr.local ||
      tr.origin === REGISTRY_ORIGIN ||
      (writtenFor === doc.clientID && Date.now() - writtenAt < SEEN_REFRESH_MS) ||
      !tr.insertSet.clients.has(doc.clientID)
    ) {
      return;
    }
    // Outside the transaction that is finishing.
    queued = true;
    queueMicrotask(write);
  };
  doc.on('afterTransaction', onTransaction);
  return () => {
    stopped = true;
    doc.off('afterTransaction', onTransaction);
  };
}
