import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import { exports } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { noteSocketPath } from '../shared/ids';
import {
  MESSAGE_AWARENESS,
  MESSAGE_NOTE_STATUS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
} from '../shared/protocol';

/**
 * A minimal y-websocket client for Durable Object tests: a Yjs 14 document
 * synced over a WebSocket to the Worker, speaking the same protocol as
 * `@y/websocket`.
 */
export class TestClient {
  readonly doc = TestClient.createDoc();
  readonly socket: WebSocket;
  synced = false;
  lastStatus: { bytes: number; rejected: boolean } | null = null;
  rejections = 0;
  closed: CloseEvent | null = null;
  readonly awarenessMessages: Uint8Array[] = [];
  private listeners = new Set<() => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.onMessage(new Uint8Array(event.data as ArrayBuffer));
      this.notify();
    });
    socket.addEventListener('close', (event) => {
      this.closed = event;
      this.notify();
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        this.send(encoding.toUint8Array(encoder));
      }
    });
  }

  /** Format cleanup off, as @lexical/y keeps it in its containers on clients. */
  private static createDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.cleanupFormatting = false;
    return doc;
  }

  static async connect(noteId: string): Promise<TestClient> {
    const response = await exports.default.fetch(`http://jot.test${noteSocketPath(noteId)}`, {
      headers: { Upgrade: 'websocket' },
    });
    const socket = response.webSocket;
    if (socket === null || socket === undefined) {
      throw new Error(`expected a WebSocket, got ${response.status}`);
    }
    socket.binaryType = 'arraybuffer';
    socket.accept();
    const client = new TestClient(socket);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, client.doc);
    client.send(encoding.toUint8Array(encoder));
    await client.until(() => client.synced);
    return client;
  }

  get text(): string {
    return this.doc.get('text').toString();
  }

  type(index: number, content: string): void {
    this.doc.get('text').insert(index, content);
  }

  send(message: Uint8Array): void {
    this.socket.send(message);
  }

  close(): void {
    this.socket.close(1000, 'done');
  }

  /** Resolves when `predicate` holds, checking after every message. */
  until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    if (predicate()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error('timed out waiting for the test client'));
      }, timeoutMs);
      const check = () => {
        if (predicate()) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve();
        }
      };
      this.listeners.add(check);
    });
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private onMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    while (decoding.hasContent(decoder)) {
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const subtype = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (subtype === syncProtocol.messageYjsSyncStep2) {
          this.synced = true;
        }
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder));
        }
      } else if (type === MESSAGE_AWARENESS) {
        this.awarenessMessages.push(decoding.readVarUint8Array(decoder));
      } else if (type === MESSAGE_NOTE_STATUS) {
        const bytes = decoding.readVarUint(decoder);
        const flags = decoding.readVarUint(decoder);
        const rejected = (flags & NOTE_STATUS_REJECTED) !== 0;
        this.lastStatus = { bytes, rejected };
        if (rejected) {
          this.rejections++;
        }
      } else {
        throw new Error(`unexpected message type ${type}`);
      }
    }
  }
}
