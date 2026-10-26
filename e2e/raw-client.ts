import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { MESSAGE_SYNC } from '../src/shared/protocol';

/**
 * Writes to a note from Node over the real protocol, without the editor:
 * for states a browser cannot easily reach (a document from a newer layout).
 */
export async function writeRawNote(
  baseURL: string,
  id: string,
  write: (doc: Y.Doc) => void,
): Promise<void> {
  const doc = new Y.Doc();
  const socket = new WebSocket(`${baseURL.replace(/^http/, 'ws')}/api/n/${id}/ws`);
  socket.binaryType = 'arraybuffer';
  const send = (build: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    build(encoder);
    socket.send(encoding.toUint8Array(encoder));
  };
  await new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error('socket error'));
    socket.onopen = () => send((encoder) => syncProtocol.writeSyncStep1(encoder, doc));
    socket.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
        return;
      }
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const type = syncProtocol.readSyncMessage(decoder, reply, doc, 'remote');
      if (encoding.length(reply) > 1) {
        socket.send(encoding.toUint8Array(reply));
      }
      if (type === syncProtocol.messageYjsSyncStep2) {
        resolve();
      }
    };
  });
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') {
      updates.push(update);
    }
  });
  write(doc);
  for (const update of updates) {
    send((encoder) => syncProtocol.writeUpdate(encoder, update));
  }
  // Leaving makes the Durable Object save at once.
  await new Promise((resolve) => setTimeout(resolve, 200));
  socket.close();
}
