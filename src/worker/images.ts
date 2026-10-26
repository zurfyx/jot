/**
 * Image uploads and serving (D26). The note's Durable Object decides whether
 * an upload may be stored (it keeps the note's image count and bytes); this
 * module reads and checks the upload, and serves stored images from R2.
 */

import {
  IMAGE_EXTENSIONS,
  IMAGE_MAX_BYTES,
  type ImageType,
  type ImageUploadError,
  imageObjectKey,
  isImageType,
  sniffImageType,
} from '../shared/images';

/** Served images never change under their key. */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function uploadError(error: ImageUploadError): Response {
  const status =
    error === 'type' ? 415 : error === 'too-large' ? 413 : /* caps and a full note */ 409;
  return Response.json({ error }, { status });
}

/**
 * Reads at most `limit` bytes of a body. Returns null when the body is
 * longer, without reading the rest of it.
 */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | null> {
  if (body === null) {
    return new Uint8Array(0);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * The upload's bytes and type, or the response that refuses it. The body is
 * the raw file. Its declared Content-Type must be one of jot's image types
 * and match what the bytes say (cross-site forms can't send such a type, so
 * this also keeps other sites from uploading through a visitor's browser).
 */
export async function readUpload(
  request: Request,
): Promise<{ bytes: Uint8Array; type: ImageType } | Response> {
  const declared = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!isImageType(declared)) {
    return uploadError('type');
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > IMAGE_MAX_BYTES) {
    return uploadError('too-large');
  }
  const bytes = await readLimited(request.body, IMAGE_MAX_BYTES);
  if (bytes === null) {
    return uploadError('too-large');
  }
  const type = sniffImageType(bytes);
  if (type === null || type !== declared) {
    return uploadError('type');
  }
  return { bytes, type };
}

/** R2 metadata for a stored image: served exactly as stored. */
export function imageHttpMetadata(type: ImageType): R2HTTPMetadata {
  return {
    contentType: type,
    cacheControl: IMAGE_CACHE_CONTROL,
    contentDisposition: `inline; filename="image.${IMAGE_EXTENSIONS[type]}"`,
  };
}

/**
 * Serves image `key` of note `noteId` from R2: its sniffed type, a long
 * immutable cache, `nosniff`, a fixed file name, a sandboxing CSP, and
 * same-origin only, so other sites can't embed jot's images.
 */
export async function serveImage(
  request: Request,
  bucket: R2Bucket,
  noteId: string,
  key: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const objectKey = imageObjectKey(noteId, key);
  const object =
    request.method === 'HEAD'
      ? await bucket.head(objectKey)
      : await bucket.get(objectKey, { onlyIf: request.headers });
  if (object === null) {
    return new Response('Not found.', { status: 404 });
  }
  const stored = object.httpMetadata?.contentType ?? '';
  const type = isImageType(stored) ? stored : null;
  const headers = new Headers({
    'Content-Type': type ?? 'application/octet-stream',
    'Cache-Control': IMAGE_CACHE_CONTROL,
    'Content-Disposition':
      type === null ? 'attachment' : `inline; filename="image.${IMAGE_EXTENSIONS[type]}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    ETag: object.httpEtag,
  });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size));
    return new Response(null, { status: 200, headers });
  }
  if (!isObjectBody(object)) {
    // A conditional request whose ETag still matches.
    return new Response(null, { status: 304, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function isObjectBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return 'body' in object && object.body instanceof ReadableStream;
}
