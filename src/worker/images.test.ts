import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { generateNoteId } from '../shared/ids';
import {
  IMAGE_MAX_BYTES,
  imageObjectPrefix,
  imagePath,
  type ImageUploadResult,
  isImageKey,
  NOTE_MAX_IMAGES,
  noteImagesPath,
  parseImagePath,
} from '../shared/images';
import { NOTE_EXPIRY_MS } from '../shared/limits';
import type { NoteRoom } from './room';
import { TestClient } from './test-client';

const ORIGIN = 'http://jot.test';

const MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': Array.from('GIF89a', (c) => c.charCodeAt(0)),
  'image/webp': [
    ...Array.from('RIFF', (c) => c.charCodeAt(0)),
    0,
    0,
    0,
    0,
    ...Array.from('WEBP', (c) => c.charCodeAt(0)),
  ],
} as const;

type Type = keyof typeof MAGIC;

/** A file whose first bytes say `type`, padded to `size` bytes. */
function fileOf(type: Type, size = 256): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(MAGIC[type]);
  for (let i = MAGIC[type].length; i < size; i++) {
    bytes[i] = (i * 31) & 0xff;
  }
  return bytes;
}

function upload(id: string, body: Uint8Array | string, type: string): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${noteImagesPath(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body,
  });
}

async function uploadOk(
  id: string,
  type: Type = 'image/png',
  size = 256,
): Promise<ImageUploadResult> {
  const response = await upload(id, fileOf(type, size), type);
  expect(response.status).toBe(201);
  return response.json<ImageUploadResult>();
}

async function errorOf(response: Response): Promise<string> {
  return (await response.json<{ error: string }>()).error;
}

function stubFor(id: string) {
  return env.NOTES.get(env.NOTES.idFromName(id));
}

async function objectsOf(id: string): Promise<string[]> {
  const listed = await env.IMAGES.list({ prefix: imageObjectPrefix(id) });
  return listed.objects.map((object) => object.key);
}

/** Random text: Yjs does not compress, so its encoded size tracks its length. */
function filler(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz ';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[(i * 7919 + (i >> 3)) % alphabet.length];
  }
  return out;
}

describe('image uploads (D26)', () => {
  it('stores each type under the note id with a random key, and serves it back', async () => {
    const id = generateNoteId();
    for (const type of Object.keys(MAGIC) as Type[]) {
      const file = fileOf(type);
      const { key, src } = await uploadOk(id, type);
      expect(isImageKey(key)).toBe(true);
      expect(src).toBe(imagePath(id, key));
      expect(parseImagePath(src)).toEqual({ noteId: id, key });

      const stored = await env.IMAGES.get(`${id}/${key}`);
      expect(stored?.httpMetadata?.contentType).toBe(type);
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(file);

      const served = await exports.default.fetch(`${ORIGIN}${src}`);
      expect(served.status).toBe(200);
      expect(served.headers.get('Content-Type')).toBe(type);
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(file);
    }
    expect(await objectsOf(id)).toHaveLength(4);
  });

  it('generates keys on the server, never from the file or its name', async () => {
    const id = generateNoteId();
    const response = await exports.default.fetch(`${ORIGIN}${noteImagesPath(id)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="../../evil.png"',
      },
      body: fileOf('image/png'),
    });
    const first = await response.json<ImageUploadResult>();
    const second = await uploadOk(id);
    expect(first.key).not.toBe(second.key);
    expect(isImageKey(first.key)).toBe(true);
    expect(first.key).not.toContain('evil');
    expect((await objectsOf(id)).sort()).toEqual(
      [`${id}/${first.key}`, `${id}/${second.key}`].sort(),
    );
  });

  it('serves images with a long immutable cache, nosniff, noindex and a safe disposition', async () => {
    const id = generateNoteId();
    const { src } = await uploadOk(id, 'image/webp');
    const served = await exports.default.fetch(`${ORIGIN}${src}`);
    expect(served.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(served.headers.get('Content-Disposition')).toBe('inline; filename="image.webp"');
    expect(served.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(served.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    const etag = served.headers.get('ETag');
    expect(etag).toBeTruthy();
    await served.body?.cancel();

    const again = await exports.default.fetch(`${ORIGIN}${src}`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(again.status).toBe(304);

    const head = await exports.default.fetch(`${ORIGIN}${src}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('256');
  });

  it('refuses anything that is not a PNG, JPEG, WebP or GIF by its bytes', async () => {
    const id = generateNoteId();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const cases: [Uint8Array | string, string][] = [
      ['not an image', 'image/png'], // declared PNG, bytes are text
      [svg, 'image/svg+xml'],
      [svg, 'image/png'],
      [fileOf('image/png'), 'image/jpeg'], // bytes and declared type disagree
      [fileOf('image/png'), 'text/plain'], // what a cross-site form could send
      [fileOf('image/png'), ''],
      [new Uint8Array([0x89, 0x50, 0x4e]), 'image/png'], // truncated magic
      [new Uint8Array(0), 'image/gif'],
    ];
    for (const [body, type] of cases) {
      const response = await upload(id, body, type);
      expect(response.status, type).toBe(415);
      expect(await errorOf(response)).toBe('type');
    }
    expect(await objectsOf(id)).toEqual([]);
  });

  it(`refuses a file over ${IMAGE_MAX_BYTES} bytes and takes one at the limit`, async () => {
    const id = generateNoteId();
    const response = await upload(id, fileOf('image/png', IMAGE_MAX_BYTES + 1), 'image/png');
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe('too-large');
    await uploadOk(id, 'image/png', IMAGE_MAX_BYTES);
    expect(await objectsOf(id)).toHaveLength(1);
  });

  it(`stops at ${NOTE_MAX_IMAGES} images per note`, async () => {
    const id = generateNoteId();
    for (let i = 0; i < NOTE_MAX_IMAGES; i++) {
      await uploadOk(id);
    }
    const response = await upload(id, fileOf('image/png'), 'image/png');
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('too-many');
    expect(await objectsOf(id)).toHaveLength(NOTE_MAX_IMAGES);
    // Another note is not affected.
    await uploadOk(generateNoteId());
  });

  it('stops when the note’s images would pass 10 MB', async () => {
    const id = generateNoteId();
    for (let i = 0; i < 6; i++) {
      await uploadOk(id, 'image/jpeg', IMAGE_MAX_BYTES); // 9 MB
    }
    const response = await upload(id, fileOf('image/jpeg', IMAGE_MAX_BYTES), 'image/jpeg');
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('no-room');
    // A smaller one still fits under 10 MB.
    await uploadOk(id, 'image/jpeg', 900_000);
    const usage = await runInDurableObject(stubFor(id), (room: NoteRoom) => room.imageUsage());
    expect(usage).toEqual({ count: 7, bytes: 6 * IMAGE_MAX_BYTES + 900_000 });
  });

  it('refuses uploads to a note whose text is full', async () => {
    const id = generateNoteId();
    const writer = await TestClient.connect(id);
    writer.type(0, filler(950_000));
    await writer.until(() => writer.text.length === 950_000, 15_000);
    writer.type(950_000, filler(950_000));
    await writer.until(() => writer.text.length === 1_900_000, 15_000);
    // Room left for an image node.
    await uploadOk(id);

    writer.type(1_900_000, filler(99_000));
    await writer.until(() => writer.text.length === 1_999_000, 15_000);
    expect(writer.rejections).toBe(0);
    const response = await upload(id, fileOf('image/png'), 'image/png');
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('note-full');
    expect(await objectsOf(id)).toHaveLength(1);
    writer.close();
  });

  it('counts an upload as a visit: it sets the expiry alarm', async () => {
    const id = generateNoteId();
    await uploadOk(id);
    const alarm = await runInDurableObject(stubFor(id), (_room: NoteRoom, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm!).toBeGreaterThan(Date.now() + NOTE_EXPIRY_MS - 60_000);
  });

  it('deletes the note’s images from R2 when the note expires, and no other note’s', async () => {
    const id = generateNoteId();
    const other = generateNoteId();
    const a = await TestClient.connect(id);
    a.type(0, 'with pictures');
    await a.until(() => a.text === 'with pictures');
    const { src } = await uploadOk(id);
    await uploadOk(id, 'image/gif');
    await uploadOk(other);
    a.close();

    // Not while someone is connected.
    const b = await TestClient.connect(id);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(await objectsOf(id)).toHaveLength(2);
    b.close();
    await expect
      .poll(() =>
        runInDurableObject(stubFor(id), (_room: NoteRoom, state) => state.getWebSockets().length),
      )
      .toBe(0);

    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(await objectsOf(id)).toEqual([]);
    expect(await objectsOf(other)).toHaveLength(1);
    const gone = await exports.default.fetch(`${ORIGIN}${src}`);
    expect(gone.status).toBe(404);
    await gone.body?.cancel();
    const usage = await runInDurableObject(stubFor(id), (room: NoteRoom) => room.imageUsage());
    expect(usage).toEqual({ count: 0, bytes: 0 });
  });

  it('cleans up images of a note that never stored any text', async () => {
    const id = generateNoteId();
    await uploadOk(id);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(await objectsOf(id)).toEqual([]);
  });
});

describe('image routes', () => {
  it('rejects malformed note ids and keys, and unknown images', async () => {
    const id = generateNoteId();
    const cases: [string, RequestInit, number][] = [
      ['/api/n/nope/images', { method: 'POST' }, 400],
      ['/api/n/public/images', { method: 'POST' }, 400],
      [`${noteImagesPath(id)}/nope`, {}, 400],
      [`${noteImagesPath(id)}/..%2F..%2Fsecret`, {}, 400],
      [`${noteImagesPath('nope')}/${generateNoteId()}`, {}, 400],
      [noteImagesPath(id), {}, 405],
      [`${noteImagesPath(id)}/${generateNoteId()}`, { method: 'DELETE' }, 405],
      [`${noteImagesPath(id)}/${generateNoteId()}`, {}, 404],
    ];
    for (const [path, init, status] of cases) {
      const response = await exports.default.fetch(`${ORIGIN}${path}`, init);
      expect(response.status, path).toBe(status);
      expect(response.headers.get('X-Robots-Tag'), path).toBe('noindex, nofollow');
      await response.body?.cancel();
    }
  });

  it('serves an image only under its own note', async () => {
    const id = generateNoteId();
    const { key } = await uploadOk(id);
    const elsewhere = await exports.default.fetch(`${ORIGIN}${imagePath(generateNoteId(), key)}`);
    expect(elsewhere.status).toBe(404);
    await elsewhere.body?.cancel();
  });
});
