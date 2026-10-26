import { describe, expect, it } from 'vitest';

import { generateNoteId } from '../../../shared/ids';
import { generateImageKey, imagePath } from '../../../shared/images';
import { imageProblemText, isCandidateImage } from './controller';
import { readUploadResponse, UploadError } from './upload';

describe('readUploadResponse', () => {
  const id = generateNoteId();
  const key = generateImageKey();

  it('accepts the server’s answer only for an image of this note', () => {
    expect(readUploadResponse(id, 201, JSON.stringify({ key, src: imagePath(id, key) }))).toEqual({
      key,
      src: imagePath(id, key),
    });
    for (const body of [
      JSON.stringify({ key, src: imagePath(generateNoteId(), key) }),
      JSON.stringify({ key, src: 'https://evil.example/x.png' }),
      JSON.stringify({ key: 'nope', src: imagePath(id, key) }),
      'not json',
    ]) {
      expect(readUploadResponse(id, 201, body)).toEqual(new UploadError('network'));
    }
  });

  it('reads the server’s reasons, and anything else as the network', () => {
    for (const error of ['type', 'too-large', 'too-many', 'no-room', 'note-full'] as const) {
      const result = readUploadResponse(id, 409, JSON.stringify({ error }));
      expect(result).toBeInstanceOf(UploadError);
      expect((result as UploadError).reason).toBe(error);
    }
    expect((readUploadResponse(id, 409, '{"error":"other"}') as UploadError).reason).toBe(
      'network',
    );
    expect((readUploadResponse(id, 502, 'Bad gateway') as UploadError).reason).toBe('network');
  });
});

describe('image messages', () => {
  it('names the file and the reason, without em dashes', () => {
    const texts = (
      [
        'not-image',
        'type',
        'unreadable',
        'too-large',
        'animated-too-large',
        'too-many',
        'no-room',
        'note-full',
        'network',
      ] as const
    ).map((problem) => imageProblemText('cat.png', problem));
    for (const text of texts) {
      expect(text).toContain('cat.png');
      expect(text).not.toContain('—');
    }
    expect(imageProblemText('cat.png', 'too-many')).toBe(
      'Couldn’t add cat.png: a note holds at most 20 images.',
    );
    expect(imageProblemText('', 'network')).toBe(
      'Couldn’t upload the image. Check the connection and try again.',
    );
  });

  it('takes image files the browser may decode, never SVG', () => {
    expect(isCandidateImage({ type: 'image/png' })).toBe(true);
    expect(isCandidateImage({ type: 'image/avif' })).toBe(true);
    expect(isCandidateImage({ type: 'image/svg+xml' })).toBe(false);
    expect(isCandidateImage({ type: 'text/plain' })).toBe(false);
    expect(isCandidateImage({ type: '' })).toBe(false);
  });
});
