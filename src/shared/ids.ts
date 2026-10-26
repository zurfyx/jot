/**
 * Note ids (D02). A note's link is its key: a random 128-bit value, written
 * as 22 base64url characters. 128 bits fill 21 characters (126 bits) plus the
 * top 2 bits of the 22nd, so the last character is always one of A, Q, g, w.
 */

/** The one note with a fixed id. It never expires (D06). */
export const PUBLIC_NOTE_ID = 'public';

const ID_BYTES = 16;
const ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh note id from the platform's cryptographic random source. */
export function generateNoteId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/** True for a well-formed note id: a generated one, or the public note. */
export function isNoteId(value: string): boolean {
  return value === PUBLIC_NOTE_ID || ID_PATTERN.test(value);
}

/** The path of a note's page. */
export function notePath(id: string): string {
  return `/n/${id}`;
}

/** Where notes' WebSockets live. */
export const NOTE_SOCKET_BASE = '/api/n';

/** The path of a note's WebSocket, relative to the origin. */
export function noteSocketPath(id: string): string {
  return `${NOTE_SOCKET_BASE}/${id}/ws`;
}

/** A short form of an id for prose: "k3Jd9x…". */
export function shortNoteId(id: string): string {
  return id === PUBLIC_NOTE_ID ? id : `${id.slice(0, 6)}…`;
}
