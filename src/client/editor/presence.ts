/**
 * Who you are to the others on a note: a name and a colour, kept in this
 * browser. Colours are indexes into the theme's `--peer-*` tokens, so they
 * follow light and dark mode.
 */

export const PEER_COLORS = 8;

export interface PeerUser {
  name: string;
  color: number;
}

const NAME_KEY = 'jot:name';
const COLOR_KEY = 'jot:color';

const ADJECTIVES = [
  'Amber',
  'Brisk',
  'Calm',
  'Clever',
  'Daring',
  'Eager',
  'Gentle',
  'Happy',
  'Keen',
  'Lively',
  'Mellow',
  'Nimble',
  'Quiet',
  'Rapid',
  'Steady',
  'Sunny',
];
const ANIMALS = [
  'Badger',
  'Crane',
  'Dolphin',
  'Falcon',
  'Fox',
  'Heron',
  'Koala',
  'Lynx',
  'Otter',
  'Owl',
  'Panda',
  'Puffin',
  'Robin',
  'Seal',
  'Swift',
  'Wren',
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: a new name per page.
  }
}

export function localUser(): PeerUser {
  let name = read(NAME_KEY);
  if (name === null || name.trim() === '') {
    name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
    write(NAME_KEY, name);
  }
  let color = Number(read(COLOR_KEY));
  if (!Number.isInteger(color) || color < 0 || color >= PEER_COLORS) {
    color = Math.floor(Math.random() * PEER_COLORS);
    write(COLOR_KEY, String(color));
  }
  return { name, color };
}

/** A remote user's fields, defensively: awareness states are untrusted input. */
export function parsePeerUser(value: unknown): PeerUser | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { name, color } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof color !== 'number') {
    return null;
  }
  const index = Math.abs(Math.trunc(color)) % PEER_COLORS;
  return { name: name.slice(0, 40), color: Number.isFinite(index) ? index : 0 };
}
