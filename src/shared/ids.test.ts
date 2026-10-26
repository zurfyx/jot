import { describe, expect, it } from 'vitest';

import {
  encodeBase64Url,
  generateNoteId,
  isNoteId,
  notePath,
  noteSocketPath,
  shortNoteId,
} from './ids';

describe('generateNoteId', () => {
  it('makes 22 base64url characters', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateNoteId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isNoteId(id)).toBe(true);
    }
  });

  it('carries 128 bits: decoding gives back 16 bytes', () => {
    const id = generateNoteId();
    const binary = atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==');
    expect(binary.length).toBe(16);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, generateNoteId));
    expect(ids.size).toBe(1000);
  });
});

describe('encodeBase64Url', () => {
  it('uses the URL alphabet without padding', () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(encodeBase64Url(new Uint8Array(16))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('isNoteId', () => {
  it.each([
    '',
    'public', // there is no public note
    'Public',
    'AAAAAAAAAAAAAAAAAAAAA', // 21
    'AAAAAAAAAAAAAAAAAAAAAAA', // 23
    'AAAAAAAAAAAAAAAAAAAAAB', // last character outside A, Q, g, w: not 128 bits
    'AAAAAAAAAAAAAAAAAAAA+A',
    'AAAAAAAAAAAAAAAAAAAA/A',
    'AAAAAAAAAAAAAAAAAAAA=A',
    '../AAAAAAAAAAAAAAAAAAA',
  ])('rejects %j', (value) => {
    expect(isNoteId(value)).toBe(false);
  });

  it.each(['AAAAAAAAAAAAAAAAAAAAAA', 'k3Jd9xQ2vL8a-_k3Jd9xQw', 'zzzzzzzzzzzzzzzzzzzzzg'])(
    'accepts %j',
    (value) => {
      expect(isNoteId(value)).toBe(true);
    },
  );
});

describe('paths', () => {
  it('builds note and socket paths', () => {
    const id = 'k3Jd9xQ2vL8a-_k3Jd9xQw';
    expect(notePath(id)).toBe(`/n/${id}`);
    expect(noteSocketPath(id)).toBe(`/api/n/${id}/ws`);
  });

  it('shortens ids for prose', () => {
    expect(shortNoteId('k3Jd9xQ2vL8a-_k3Jd9xQw')).toBe('k3Jd9x…');
  });
});
