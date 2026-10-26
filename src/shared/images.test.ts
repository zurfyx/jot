import { describe, expect, it } from 'vitest';

import { generateNoteId } from './ids';
import {
  generateImageKey,
  imageObjectKey,
  imageObjectPrefix,
  imagePath,
  isAnimatedGif,
  isImageKey,
  isOwnImagePath,
  parseImagePath,
  sniffImageType,
} from './images';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : part,
    ),
  );

/** A GIF with `frames` 1×1 frames and a global colour table of two entries. */
function gif(frames: number, extensions = true): Uint8Array {
  const header = bytes('GIF89a', [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255]);
  const loop = bytes([0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0]);
  const frame = bytes(
    extensions ? [0x21, 0xf9, 4, 0, 10, 0, 0, 0] : [],
    [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    [2, 2, 0x4c, 0x01, 0],
  );
  const parts = [
    header,
    ...(frames > 1 ? [loop] : []),
    ...Array.from({ length: frames }, () => frame),
    bytes([0x3b]),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('sniffImageType', () => {
  it('tells the four types by their magic bytes', () => {
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(sniffImageType(bytes('GIF87a'))).toBe('image/gif');
    expect(sniffImageType(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('image/webp');
  });

  it('refuses everything else, and truncated or near-miss headers', () => {
    for (const input of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      bytes('<?xml version="1.0"?><svg/>'),
      bytes('<html><script>'),
      bytes([0x89, 0x50, 0x4e, 0x47]), // PNG cut short
      bytes([0xff, 0xd8]),
      bytes('GIF88a'),
      bytes('RIFF', [0, 0, 0, 0], 'WAVE'), // a WAV file
      bytes('RIFF'),
      bytes([0x42, 0x4d, 0, 0]), // BMP
      bytes([0, 0, 0, 0x1c], 'ftypavif'), // AVIF
      new Uint8Array(0),
    ]) {
      expect(sniffImageType(input)).toBeNull();
    }
  });
});

describe('isAnimatedGif', () => {
  it('counts frames', () => {
    expect(isAnimatedGif(gif(1))).toBe(false);
    expect(isAnimatedGif(gif(1, false))).toBe(false);
    expect(isAnimatedGif(gif(2))).toBe(true);
    expect(isAnimatedGif(gif(5, false))).toBe(true);
  });

  it('never throws on malformed input and calls it still', () => {
    expect(isAnimatedGif(bytes('GIF89a'))).toBe(false);
    expect(isAnimatedGif(gif(2).slice(0, 40))).toBe(false);
    expect(isAnimatedGif(bytes([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('image keys and paths', () => {
  it('generates random 128-bit keys', () => {
    const keys = new Set(Array.from({ length: 200 }, generateImageKey));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(isImageKey(key)).toBe(true);
    }
  });

  it('builds and parses a note’s image paths and R2 keys', () => {
    const id = generateNoteId();
    const key = generateImageKey();
    expect(imagePath(id, key)).toBe(`/api/n/${id}/images/${key}`);
    expect(parseImagePath(imagePath(id, key))).toEqual({ noteId: id, key });
    expect(imageObjectKey(id, key)).toBe(`${id}/${key}`);
    expect(imageObjectKey(id, key).startsWith(imageObjectPrefix(id))).toBe(true);
    expect(isOwnImagePath(imagePath(id, key), id)).toBe(true);
    expect(isOwnImagePath(imagePath(generateNoteId(), key), id)).toBe(false);
  });

  it('parses nothing but a jot image path', () => {
    const id = generateNoteId();
    const key = generateImageKey();
    for (const value of [
      `https://jot.rovira.sh/api/n/${id}/images/${key}`,
      `//evil.example/api/n/${id}/images/${key}`,
      `/api/n/${id}/images/${key}?x=1`,
      `/api/n/${id}/images/${key}#x`,
      `/api/n/${id}/images/${key}/`,
      `/api/n/${id}/images/../${key}`,
      `/api/n/public/images/${key}`,
      `/api/n/${id}/images/nope`,
      `/api/n/${id}/ws`,
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'https://evil.example/tracker.png',
      '',
    ]) {
      expect(parseImagePath(value), value).toBeNull();
    }
  });
});
