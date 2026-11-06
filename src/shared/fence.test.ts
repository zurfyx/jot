import { describe, expect, it } from 'vitest';

import {
  decodeUpload,
  encodeUpload,
  type Handshake,
  handshakeParams,
  parseHandshake,
  sha256Hex,
  UNKNOWN_GENERATION,
  type Upload,
} from './fence';

const url = (params: Record<string, string>) =>
  new URL(`https://jot.test/api/n/x/ws?${new URLSearchParams(params).toString()}`);

describe('handshake', () => {
  it('round-trips through the socket URL', () => {
    const cases: Handshake[] = [
      { v: 1, generation: null, material: false, layouts: [1, 2], seed: 1, features: [] },
      { v: 1, generation: 'g1:["i",[]]', material: true, layouts: [3, 3], seed: 3, features: [] },
      {
        v: 1,
        generation: UNKNOWN_GENERATION,
        material: true,
        layouts: [1, 2],
        seed: 1,
        features: ['a-feature', 'other.2'],
      },
    ];
    for (const handshake of cases) {
      expect(parseHandshake(url(handshakeParams(handshake)))).toEqual(handshake);
    }
  });

  it('is null without the fence parameter: a client from before the fence', () => {
    expect(parseHandshake(new URL('https://jot.test/api/n/x/ws'))).toBeNull();
  });

  it('throws on a malformed one', () => {
    const good = handshakeParams({
      v: 1,
      generation: null,
      material: false,
      layouts: [1, 2],
      seed: 1,
      features: [],
    });
    for (const bad of [
      { ...good, f: '2' },
      { ...good, m: 'yes' },
      { ...good, lo: '3', hi: '2' },
      { ...good, lo: '0' },
      { ...good, seed: 'x' },
      { ...good, g: 'g'.repeat(600) },
      { ...good, ft: 'Bad Feature' },
      { ...good, ft: 'a,,b' },
      { ...good, ft: Array.from({ length: 33 }, (_, i) => `f${i}`).join(',') },
    ]) {
      expect(() => parseHandshake(url(bad))).toThrow();
    }
  });
});

describe('upload envelope', () => {
  const upload: Upload = {
    session: 's1',
    replica: 'tab',
    source: {
      incarnation: null,
      generation: 'g/-',
      layouts: [1, 2],
      schemaVersion: 1,
      renderer: 'jot',
    },
    snapshot: new Uint8Array([0, 0]),
    queue: [new Uint8Array([1, 2, 3])],
    draft: { json: { root: {} }, differs: true },
    clients: [7, 8],
    peers: false,
  };

  it('round-trips', () => {
    expect(decodeUpload(encodeUpload(upload))).toEqual(upload);
  });

  it('refuses trailing bytes, other versions and bad fields', () => {
    const bytes = encodeUpload(upload);
    expect(() => decodeUpload(new Uint8Array([...bytes, 0]))).toThrow();
    expect(() => decodeUpload(new Uint8Array([2, ...bytes.slice(1)]))).toThrow();
    expect(() => decodeUpload(encodeUpload({ ...upload, clients: [1.5] }))).toThrow();
    expect(() =>
      decodeUpload(encodeUpload({ ...upload, peers: 'no' as unknown as boolean })),
    ).toThrow();
  });

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
