import { describe, expect, it } from 'vitest';

import {
  capState,
  fitsUnderCap,
  NOTE_EXPIRY_MS,
  NOTE_MAX_BYTES,
  NOTE_WARN_BYTES,
  UPDATE_OVERHEAD_BYTES,
} from './limits';

describe('limits', () => {
  it('caps a note at 2 MB and warns at 1.6 MB', () => {
    expect(NOTE_MAX_BYTES).toBe(2_000_000);
    expect(NOTE_WARN_BYTES).toBe(1_600_000);
  });

  it('expires after 90 days', () => {
    expect(NOTE_EXPIRY_MS).toBe(90 * 86_400_000);
  });
});

describe('capState', () => {
  it.each([
    [0, 'ok'],
    [NOTE_WARN_BYTES - 1, 'ok'],
    [NOTE_WARN_BYTES, 'warn'],
    [NOTE_MAX_BYTES - 1, 'warn'],
    [NOTE_MAX_BYTES, 'full'],
    [NOTE_MAX_BYTES + 1, 'full'],
  ] as const)('%d bytes is %s', (bytes, state) => {
    expect(capState(bytes)).toBe(state);
  });
});

describe('fitsUnderCap', () => {
  it('allows updates that keep the bound under the cap', () => {
    expect(fitsUnderCap(0, 100)).toBe(true);
    expect(fitsUnderCap(NOTE_MAX_BYTES - 100 - UPDATE_OVERHEAD_BYTES, 100)).toBe(true);
  });

  it('refuses updates whose bound passes the cap', () => {
    expect(fitsUnderCap(NOTE_MAX_BYTES - 100 - UPDATE_OVERHEAD_BYTES, 101)).toBe(false);
    expect(fitsUnderCap(NOTE_MAX_BYTES, 1)).toBe(false);
  });
});
