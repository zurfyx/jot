import { buildEditorFromExtensions } from '@lexical/extension';
import { RichTextExtension } from '@lexical/rich-text';
import { YCollabExtension } from '@lexical/y';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { fromBase64, toBase64 } from 'lib0/buffer';
import { configExtension, defineExtension } from 'lexical';

const KEY = 'my-app:draft';

/** A note with no server yet: it lives in this browser until it's shared. */
export function openDraft() {
  const doc = new Y.Doc();
  const saved = localStorage.getItem(KEY);
  if (saved !== null) Y.applyUpdate(doc, fromBase64(saved)); // before the binding reads it

  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'my-app/draft',
      // Nothing to wait for, so the binding initializes at once.
      dependencies: [RichTextExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  doc.on('update', () => {
    clearTimeout(timer);
    timer = setTimeout(() => localStorage.setItem(KEY, toBase64(Y.encodeStateAsUpdate(doc))), 500);
  });

  /** Sharing connects the same document to an empty room, which receives all of it. */
  function share(id: string) {
    const provider = new WebsocketProvider('wss://jot.rovira.sh/api/n', `${id}/ws`, doc);
    provider.on('sync', (synced: boolean) => {
      // jot keeps the copy until the relay has echoed every update back.
      if (synced && provider.unconfirmedUpdates.length === 0) localStorage.removeItem(KEY);
    });
    return provider;
  }
  return { doc, editor, share };
}
