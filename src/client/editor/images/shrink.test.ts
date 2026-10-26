import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_BYTES } from '../../../shared/images';
import { altFromFileName, chooseUpload, type OriginalInfo, planFor, scaledSize } from './shrink';

const original = (patch: Partial<OriginalInfo> = {}): OriginalInfo => ({
  type: 'image/png',
  size: 400_000,
  width: 1200,
  height: 800,
  animated: false,
  ...patch,
});

describe('scaledSize', () => {
  it('fits the long side to 1600 px, keeping the ratio', () => {
    expect(scaledSize(3000, 2000)).toEqual({ width: 1600, height: 1067 });
    expect(scaledSize(2000, 4000)).toEqual({ width: 800, height: 1600 });
    expect(scaledSize(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('never scales up, and never to zero', () => {
    expect(scaledSize(40, 30)).toEqual({ width: 40, height: 30 });
    expect(scaledSize(20_000, 3)).toEqual({ width: 1600, height: 1 });
  });
});

describe('planFor', () => {
  it('keeps a GIF under the limit as it is, animation included', () => {
    expect(planFor(original({ type: 'image/gif', size: 900_000, animated: true }))).toBe('keep');
    expect(planFor(original({ type: 'image/gif', size: IMAGE_MAX_BYTES }))).toBe('keep');
  });

  it('refuses an animated GIF over the limit and re-encodes a still one', () => {
    expect(planFor(original({ type: 'image/gif', size: 3_000_000, animated: true }))).toBe(
      'animated-too-large',
    );
    expect(planFor(original({ type: 'image/gif', size: 3_000_000 }))).toBe('encode');
  });

  it('re-encodes everything else', () => {
    expect(planFor(original())).toBe('encode');
    expect(planFor(original({ type: 'image/jpeg', size: 5_000_000 }))).toBe('encode');
    expect(planFor(original({ type: null }))).toBe('encode');
  });
});

describe('chooseUpload', () => {
  it('takes the smallest encoding under the limit', () => {
    expect(
      chooseUpload(original({ size: 9_000_000, width: 4000, height: 3000 }), [
        { type: 'image/webp', size: 2_000_000 },
        { type: 'image/webp', size: 700_000 },
      ]),
    ).toBe(1);
  });

  it('keeps a small original that already fits, when no encoding beats it', () => {
    expect(chooseUpload(original({ size: 30_000 }), [{ type: 'image/webp', size: 45_000 }])).toBe(
      'original',
    );
    expect(chooseUpload(original({ size: 60_000 }), [{ type: 'image/webp', size: 45_000 }])).toBe(
      0,
    );
  });

  it('never keeps an original that is too wide, too big or of a type jot doesn’t store', () => {
    const small = [{ type: 'image/webp' as const, size: 900_000 }];
    expect(chooseUpload(original({ width: 3000, size: 100_000 }), small)).toBe(0);
    expect(chooseUpload(original({ size: 2_000_000 }), small)).toBe(0);
    expect(chooseUpload(original({ type: null, size: 1000 }), small)).toBe(0);
  });

  it('gives up when nothing fits', () => {
    expect(
      chooseUpload(original({ size: 9_000_000, width: 4000 }), [
        { type: 'image/webp', size: 1_600_000 },
        { type: 'image/jpeg', size: 1_550_000 },
      ]),
    ).toBe('too-large');
    expect(chooseUpload(original({ type: null }), [])).toBe('too-large');
  });
});

describe('altFromFileName', () => {
  it('turns a file name into alt text', () => {
    expect(altFromFileName('team-photo.jpg')).toBe('Team photo');
    expect(altFromFileName('IMG_2041.PNG')).toBe('IMG 2041');
    expect(altFromFileName('red square.webp')).toBe('Red square');
    expect(altFromFileName('archive.tar.gz')).toBe('Archive.tar');
  });

  it('leaves names that say nothing empty', () => {
    expect(altFromFileName('image.png')).toBe('');
    expect(altFromFileName('.png')).toBe('');
    expect(altFromFileName('')).toBe('');
  });
});
