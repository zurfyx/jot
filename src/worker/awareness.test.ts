import { describe, expect, it } from 'vitest';

import { AwarenessRelay, decodeAwarenessUpdate, encodeAwarenessUpdate } from './awareness';

describe('awareness encoding', () => {
  it('round-trips an update', () => {
    const changes = [
      { clientID: 1, clock: 3, state: '{"user":{"name":"Ana","color":0}}' },
      { clientID: 2 ** 40, clock: 1, state: 'null' },
    ];
    expect(decodeAwarenessUpdate(encodeAwarenessUpdate(changes))).toEqual(changes);
  });

  it('rejects malformed updates', () => {
    expect(() => decodeAwarenessUpdate(new Uint8Array([2, 1]))).toThrow();
    expect(() =>
      decodeAwarenessUpdate(encodeAwarenessUpdate([{ clientID: 1, clock: 1, state: '{nope' }])),
    ).toThrow();
    const trailing = new Uint8Array([...encodeAwarenessUpdate([]), 7]);
    expect(() => decodeAwarenessUpdate(trailing)).toThrow();
  });
});

describe('AwarenessRelay', () => {
  it('keeps the newest state per client', () => {
    const relay = new AwarenessRelay();
    expect(relay.apply([{ clientID: 1, clock: 2, state: '{"a":2}' }])).toHaveLength(1);
    expect(relay.apply([{ clientID: 1, clock: 1, state: '{"a":1}' }])).toHaveLength(0);
    expect(relay.snapshot()).toEqual([{ clientID: 1, clock: 2, state: '{"a":2}' }]);
  });

  it('forgets a client that removes itself', () => {
    const relay = new AwarenessRelay();
    relay.apply([{ clientID: 1, clock: 1, state: '{}' }]);
    expect(relay.apply([{ clientID: 1, clock: 1, state: 'null' }])).toHaveLength(1);
    expect(relay.snapshot()).toEqual([]);
  });

  it('announces departures with a newer clock', () => {
    const relay = new AwarenessRelay();
    relay.apply([{ clientID: 7, clock: 4, state: '{}' }]);
    expect(relay.remove({ 7: 4 })).toEqual([{ clientID: 7, clock: 5, state: 'null' }]);
    expect(relay.snapshot()).toEqual([]);
  });
});
