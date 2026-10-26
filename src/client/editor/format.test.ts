import { describe, expect, it } from 'vitest';

import { NOTE_MAX_BYTES } from '../../shared/limits';
import { ago, editsWaiting, formatBytes, keptUntil } from './format';

describe('formatBytes', () => {
  it('uses bytes under a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('keeps one decimal under 10 KB and none above', () => {
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(4250)).toBe('4.3 KB');
    expect(formatBytes(238_400)).toBe('238 KB');
    expect(formatBytes(999_499)).toBe('999 KB');
  });

  it('uses two decimals for megabytes, and the cap reads 2 MB', () => {
    expect(formatBytes(1_720_000)).toBe('1.72 MB');
    expect(formatBytes(1_600_000)).toBe('1.6 MB');
    expect(formatBytes(NOTE_MAX_BYTES)).toBe('2 MB');
  });
});

describe('editsWaiting', () => {
  it('counts edits in words', () => {
    expect(editsWaiting(0)).toBe('no edits waiting');
    expect(editsWaiting(1)).toBe('1 edit waiting');
    expect(editsWaiting(3)).toBe('3 edits waiting');
  });
});

describe('keptUntil', () => {
  it('is 90 days after the visit', () => {
    expect(keptUntil(Date.UTC(2026, 9, 26, 12))).toBe('Jan 24, 2027');
  });
});

describe('ago', () => {
  const now = 1_800_000_000_000;
  const at = (secondsBefore: number) => Math.floor(now / 1000) - secondsBefore;

  it('reads like a person would say it', () => {
    expect(ago(at(20), now)).toBe('just now');
    expect(ago(at(5 * 60), now)).toBe('5 min ago');
    expect(ago(at(3 * 3600 + 60), now)).toBe('3 h ago');
    expect(ago(at(86_400), now)).toBe('1 day ago');
    expect(ago(at(3 * 86_400), now)).toBe('3 days ago');
  });
});
