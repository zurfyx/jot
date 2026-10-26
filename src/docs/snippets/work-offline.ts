import type { WebsocketProvider } from '@y/websocket';
import type * as Y from '@y/y';

/**
 * Work offline: close the socket and keep editing. The document keeps every
 * local transaction; reconnecting runs the sync steps, and both sides merge.
 */
export function workOffline(provider: WebsocketProvider, doc: Y.Doc) {
  let waiting = 0;
  const count = (_update: Uint8Array, origin: unknown) => {
    if (origin !== provider) waiting++; // a local edit the server hasn't seen
  };
  provider.disconnect();
  doc.on('update', count);
  return {
    edits: () => waiting,
    reconnect() {
      doc.off('update', count);
      provider.connect();
    },
  };
}
