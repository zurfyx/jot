/**
 * Attributions: who wrote each character still in the note, from Yjs 14.
 *
 * Every item in a Y.Doc carries the client id that inserted it. Blame builds
 * a ContentMap that attributes each client's inserted ids to the person the
 * registry maps it to, renders the `lexical-y` root with an
 * AttributionsRenderer, and walks the delta into lines of runs. Deleted text
 * is not shown: jot garbage-collects it.
 */
import { DEFAULT_ROOT_NAME } from '@lexical/y';
import * as Y from '@y/y';

import { PEER_COLORS } from '../presence';
import { type BlameLine, readDelta, sharesOf } from './lines';
import { markMovedLines } from './moves';
import { type BlamePerson, type LocalIdentity, localIdentity, readRegistry } from './registry';

export interface BlameSnapshot {
  lines: BlameLine[];
  people: Map<string, BlamePerson>;
  /** Characters per person, largest first. */
  shares: { person: BlamePerson; chars: number }[];
  /** Attributed characters in total. */
  total: number;
}

export const EMPTY_SNAPSHOT: BlameSnapshot = {
  lines: [],
  people: new Map(),
  shares: [],
  total: 0,
};

/** The ContentMap attributing each registered client's inserts to its person. */
export function buildContentMap(doc: Y.Doc, clients: Map<number, string>) {
  const ids = Y.createInsertSetFromStructStore(doc.store, true);
  const byPerson = new Map<string, Y.IdSet>();
  ids.forEach((range, client) => {
    const personId = clients.get(client);
    if (personId === undefined) {
      return;
    }
    let set = byPerson.get(personId);
    if (set === undefined) {
      set = Y.createIdSet();
      byPerson.set(personId, set);
    }
    set.add(client, range.clock, range.len);
  });
  const maps = [...byPerson].map(([personId, set]) =>
    Y.createIdMapFromIdSet(set, [Y.createContentAttribute('insert', personId)]),
  );
  return Y.createContentMap(Y.mergeIdMaps(maps), Y.createIdMap());
}

/** Blame for the note as it is now. Never throws. */
export function computeBlame(doc: Y.Doc, identity: LocalIdentity = localIdentity()): BlameSnapshot {
  try {
    const { clients, people } = readRegistry(doc, identity);
    const renderer = Y.createAttributionsRenderer(buildContentMap(doc, clients));
    const root = doc.get(DEFAULT_ROOT_NAME);
    const delta = root.toDelta({ deep: true, renderer });
    const { lines, moves } = readDelta((delta as { toJSON(): unknown }).toJSON());
    if (moves) {
      // Lines a peer moved or joined are not where storage has them: skip them.
      markMovedLines(doc, root, lines);
    }
    let total = 0;
    const shares: BlameSnapshot['shares'] = [];
    for (const [personId, chars] of sharesOf(lines)) {
      const person = people.get(personId);
      if (person !== undefined) {
        shares.push({ person, chars });
        total += chars;
      }
    }
    shares.sort((a, b) => b.chars - a.chars || a.person.name.localeCompare(b.person.name));
    return separateColors({ lines, people, shares, total });
  } catch (error) {
    console.warn('jot: blame could not read this note', error);
    return EMPTY_SNAPSHOT;
  }
}

/**
 * Colours are picked at random per browser, so two people can share one.
 * Blame needs them apart: in share order, a person whose colour is taken
 * gets the next free one (while any is free). Their carets keep their own.
 */
export function separateColors(snapshot: BlameSnapshot): BlameSnapshot {
  const taken = new Set<number>();
  const people = new Map(snapshot.people);
  const shares = snapshot.shares.map(({ person, chars }) => {
    let color = person.color;
    if (taken.has(color) && taken.size < PEER_COLORS) {
      while (taken.has(color)) {
        color = (color + 1) % PEER_COLORS;
      }
    }
    taken.add(color);
    const shown = color === person.color ? person : { ...person, color };
    people.set(person.id, shown);
    return { person: shown, chars };
  });
  return { ...snapshot, people, shares };
}
