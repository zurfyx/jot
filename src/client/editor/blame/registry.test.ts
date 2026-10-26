import * as Y from '@y/y';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PEOPLE_ROOT } from '../../../shared/protocol';
import {
  parseEntry,
  readRegistry,
  REGISTRY_ORIGIN,
  SEEN_ALLOWANCE_S,
  SEEN_REFRESH_MS,
  trackLocalPerson,
  writeEntry,
} from './registry';

const user = () => ({ name: 'Brisk Otter', color: 3 });

describe('parseEntry', () => {
  it('reads an entry', () => {
    expect(parseEntry({ p: 'abc', n: 'Ana', c: 1, k: 'person', s: 5 })).toEqual({
      personId: 'abc',
      name: 'Ana',
      color: 1,
      kind: 'person',
      seen: 5,
    });
  });

  it('keeps asked-by for AI only', () => {
    expect(parseEntry({ p: 'ai', n: 'jot AI', c: 2, k: 'ai', a: 'me', s: 1 })?.askedBy).toBe('me');
    expect(
      parseEntry({ p: 'x', n: 'X', c: 2, k: 'person', a: 'me', s: 1 })?.askedBy,
    ).toBeUndefined();
  });

  it('treats strangers’ values defensively', () => {
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry('x')).toBeNull();
    expect(parseEntry([])).toBeNull();
    expect(parseEntry({ p: '', n: 'x' })).toBeNull();
    expect(parseEntry({ p: 'a', n: 3 })).toBeNull();
    const odd = parseEntry({ p: 'a'.repeat(200), n: ' '.repeat(3), c: -9.5, k: 'admin', s: 'x' })!;
    expect(odd.personId).toHaveLength(32);
    expect(odd.name).toBe('Someone');
    expect(odd.color).toBe(1);
    expect(odd.kind).toBe('person');
    expect(odd.seen).toBe(0);
    expect(parseEntry({ p: 'a', n: 'x'.repeat(100), c: Infinity })!.name).toHaveLength(40);
  });
});

describe('readRegistry', () => {
  it('maps each client id to its person and names people by their newest entry', () => {
    const doc = new Y.Doc();
    writeEntry(doc, 1, { personId: 'p', name: 'Old', color: 0, kind: 'person', seen: 10 });
    writeEntry(doc, 2, { personId: 'p', name: 'New', color: 4, kind: 'person', seen: 20 });
    writeEntry(doc, 3, { personId: 'q', name: 'Ana', color: 1, kind: 'demo', seen: 5 });
    doc.get(PEOPLE_ROOT).setAttr('not-a-client', { p: 'z', n: 'Z' });
    doc.get(PEOPLE_ROOT).setAttr('4', 'garbage');
    const { clients, people } = readRegistry(doc);
    expect([...clients]).toEqual([
      [1, 'p'],
      [2, 'p'],
      [3, 'q'],
    ]);
    expect(people.get('p')).toMatchObject({ name: 'New', color: 4, seen: 20 });
    expect(people.get('q')).toMatchObject({ kind: 'demo' });
  });
});

describe('readRegistry against strangers', () => {
  const now = 1_800_000_000_000;
  const me = { personId: 'me-123456', clients: new Set([10, 11]) };

  it('ignores a last-seen time from the future, so a forged entry can’t name someone for good', () => {
    const doc = new Y.Doc();
    writeEntry(doc, 1, {
      personId: 'ana',
      name: 'Ana',
      color: 1,
      kind: 'person',
      seen: 1_799_999_000,
    });
    writeEntry(doc, 2, { personId: 'ana', name: 'Not Ana', color: 4, kind: 'person', seen: 9e12 });
    const { people } = readRegistry(doc, me, now);
    expect(people.get('ana')).toMatchObject({ name: 'Ana', seen: 1_799_999_000 });
    // Within the allowance (a clock a little ahead) is fine.
    writeEntry(doc, 3, {
      personId: 'ana',
      name: 'Ana, renamed',
      color: 1,
      kind: 'person',
      seen: now / 1000 + SEEN_ALLOWANCE_S,
    });
    expect(readRegistry(doc, me, now).people.get('ana')!.name).toBe('Ana, renamed');
  });

  it('is you only for your own sessions’ client ids', () => {
    const doc = new Y.Doc();
    writeEntry(doc, 10, {
      personId: 'me-123456',
      name: 'Gerard',
      color: 0,
      kind: 'person',
      seen: 1,
    });
    // A stranger claims your person id...
    writeEntry(doc, 99, {
      personId: 'me-123456',
      name: 'Gerard',
      color: 0,
      kind: 'person',
      seen: 2,
    });
    // ...and overwrites one of your sessions' entries with someone else.
    writeEntry(doc, 11, {
      personId: 'ana',
      name: 'Ana',
      color: 1,
      kind: 'ai',
      a: 'x',
      seen: 3,
    } as never);
    const { clients, people } = readRegistry(doc, me, now);
    expect(clients.get(10)).toBe('me-123456');
    expect(clients.get(11)).toBe('me-123456');
    expect(clients.get(99)).toBe('~99');
    expect(people.get('~99')!.name).toBe('Gerard');
    expect(people.get('me-123456')!.kind).toBe('person');
  });
});

describe('trackLocalPerson', () => {
  let now = 1_800_000_000_000;
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const writes = (doc: Y.Doc) => {
    let count = 0;
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === REGISTRY_ORIGIN) count++;
    });
    return () => count;
  };

  it('writes nothing while the person only reads', async () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    remote.get('lexical-y').insert(0, 'from someone else');
    trackLocalPerson(doc, user, 'me-123456');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'provider');
    await Promise.resolve();
    expect(doc.get(PEOPLE_ROOT).getAttrs()).toEqual({});
  });

  it('writes its entry on the first edit, then refreshes seen at most once a minute', async () => {
    const doc = new Y.Doc();
    const count = writes(doc);
    trackLocalPerson(doc, user, 'me-123456');
    doc.get('lexical-y').insert(0, 'a');
    await Promise.resolve();
    expect(count()).toBe(1);
    expect(readRegistry(doc).people.get('me-123456')).toEqual({
      id: 'me-123456',
      name: 'Brisk Otter',
      color: 3,
      kind: 'person',
      askedBy: undefined,
      seen: Math.floor(now / 1000),
    });
    expect(readRegistry(doc).clients.get(doc.clientID)).toBe('me-123456');

    now += SEEN_REFRESH_MS - 1;
    doc.get('lexical-y').insert(0, 'b');
    await Promise.resolve();
    expect(count()).toBe(1);

    now += 2;
    doc.get('lexical-y').insert(0, 'c');
    doc.get('lexical-y').insert(0, 'd');
    await Promise.resolve();
    expect(count()).toBe(2);
    expect(readRegistry(doc).people.get('me-123456')!.seen).toBe(Math.floor(now / 1000));
  });

  it('counts deleting as editing', async () => {
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    remote.get('lexical-y').insert(0, 'from someone else');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'provider');
    const count = writes(doc);
    trackLocalPerson(doc, user, 'me-123456');
    doc.get('lexical-y').delete(0, 5);
    await Promise.resolve();
    expect(count()).toBe(1);
    now += SEEN_REFRESH_MS;
    doc.get('lexical-y').delete(0, 1);
    await Promise.resolve();
    expect(count()).toBe(2);
  });

  it('stops writing once stopped', async () => {
    const doc = new Y.Doc();
    const stop = trackLocalPerson(doc, user, 'me-123456');
    doc.get('lexical-y').insert(0, 'a');
    stop();
    await Promise.resolve();
    expect(doc.get(PEOPLE_ROOT).getAttrs()).toEqual({});
  });
});
