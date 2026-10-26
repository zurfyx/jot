/**
 * Images in notes (D26): limits, the types jot accepts, how a file's type is
 * told from its bytes, and the paths images live at. The client and the
 * Worker both import these, so they agree on every rule.
 *
 * A note's Y.Doc never holds image bytes: an image node stores the image's
 * path on jot (`/api/n/<note id>/images/<key>`), its alt text and its size.
 * The bytes live in R2 under `<note id>/<key>`.
 */

import { encodeBase64Url, isNoteId, NOTE_SOCKET_BASE } from './ids';

/** The largest file the server accepts, after the browser has shrunk it. */
export const IMAGE_MAX_BYTES = 1_500_000;

/** How many images one note may store (uploads, not images still in the text). */
export const NOTE_MAX_IMAGES = 20;

/** The bytes of all of one note's stored images together. */
export const NOTE_MAX_IMAGE_BYTES = 10_000_000;

/** The browser scales images down to this many pixels on the long side. */
export const IMAGE_MAX_EDGE = 1600;

/**
 * Room an image node needs in the note's Yjs state (its path, alt text and
 * size, generously). A note without this much room left is full: the server
 * refuses uploads to it.
 */
export const IMAGE_NODE_BYTES = 1024;

/** The longest alt text an image node keeps. */
export const IMAGE_ALT_MAX = 300;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(value: string): value is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

/** The file name extension the server suggests for each type. */
export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  if (bytes.byteLength < at + prefix.length) {
    return false;
  }
  return prefix.every((byte, i) => bytes[at + i] === byte);
}

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/**
 * The image type a file's first bytes say it is, or null. Only the magic
 * bytes count: a declared Content-Type or a file name is never trusted.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) {
    return 'image/gif';
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return 'image/webp';
  }
  return null;
}

/**
 * Whether a GIF has more than one frame. Walks the GIF's blocks and stops at
 * the second image descriptor; a malformed file counts as not animated (the
 * size limit still applies to it).
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (sniffImageType(bytes) !== 'image/gif' || bytes.byteLength < 13) {
    return false;
  }
  let pos = 13;
  const flags = bytes[10]!;
  if ((flags & 0x80) !== 0) {
    pos += 3 * (1 << ((flags & 0x07) + 1));
  }
  const skipSubBlocks = () => {
    while (pos < bytes.byteLength) {
      const size = bytes[pos]!;
      pos += 1;
      if (size === 0) {
        return;
      }
      pos += size;
    }
  };
  let frames = 0;
  while (pos < bytes.byteLength) {
    const block = bytes[pos]!;
    if (block === 0x2c) {
      frames += 1;
      if (frames > 1) {
        return true;
      }
      const localFlags = bytes[pos + 9] ?? 0;
      pos += 10;
      if ((localFlags & 0x80) !== 0) {
        pos += 3 * (1 << ((localFlags & 0x07) + 1));
      }
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else if (block === 0x21) {
      pos += 2; // introducer and label
      skipSubBlocks();
    } else {
      return false; // trailer (0x3b) or garbage
    }
  }
  return false;
}

const KEY_BYTES = 16;
const KEY_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

/** A fresh, random image key: 128 bits as 22 base64url characters, like a note id. */
export function generateImageKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function isImageKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Where a note's images are uploaded (POST). */
export function noteImagesPath(noteId: string): string {
  return `${NOTE_SOCKET_BASE}/${noteId}/images`;
}

/** Where one image is served (GET), and what an image node stores as its src. */
export function imagePath(noteId: string, key: string): string {
  return `${noteImagesPath(noteId)}/${key}`;
}

/** The R2 object key of an image: under its note's id. */
export function imageObjectKey(noteId: string, key: string): string {
  return `${noteId}/${key}`;
}

/** The R2 prefix of every image of a note. */
export function imageObjectPrefix(noteId: string): string {
  return `${noteId}/`;
}

const IMAGE_PATH = /^\/api\/n\/([A-Za-z0-9_-]{22})\/images\/([A-Za-z0-9_-]{22})$/;

/**
 * The note id and key of an image path, or null for anything else: other
 * paths, absolute URLs, other hosts, query strings, `javascript:` and `data:`.
 */
export function parseImagePath(value: string): { noteId: string; key: string } | null {
  const match = IMAGE_PATH.exec(value);
  if (match === null) {
    return null;
  }
  const noteId = match[1]!;
  const key = match[2]!;
  return isNoteId(noteId) && isImageKey(key) ? { noteId, key } : null;
}

/** Whether `src` is an image of note `noteId`, the only images a note shows. */
export function isOwnImagePath(src: string, noteId: string): boolean {
  return parseImagePath(src)?.noteId === noteId;
}

/** Why the server refused an upload: the `error` of its JSON body. */
export type ImageUploadError =
  | 'type' // not a PNG, JPEG, WebP or GIF
  | 'too-large' // over IMAGE_MAX_BYTES
  | 'too-many' // the note has NOTE_MAX_IMAGES images
  | 'no-room' // the note's images would pass NOTE_MAX_IMAGE_BYTES
  | 'note-full'; // the note's text is at its cap, so no image node fits

/** The server's answer to a successful upload. */
export interface ImageUploadResult {
  key: string;
  src: string;
}
