import { buildEditorFromExtensions } from '@lexical/extension';
import { RichTextExtension } from '@lexical/rich-text';
import { createYDoc, YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import { configExtension, defineExtension } from 'lexical';

/**
 * A second author inside the tab: its own Y.Doc (a fresh client id, so blame
 * can name it) and a headless editor, synced with the note both ways.
 */
export function createPeer(note: Y.Doc) {
  const doc = createYDoc();
  const fromNote = Symbol('from-note');
  const fromPeer = Symbol('from-peer');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(note), fromNote); // start from the note as it is
  const toPeer = (update: Uint8Array, origin: unknown) => {
    if (origin !== fromPeer) Y.applyUpdate(doc, update, fromNote);
  };
  const toNote = (update: Uint8Array, origin: unknown) => {
    if (origin !== fromNote) Y.applyUpdate(note, update, fromPeer); // never echo back
  };
  note.on('update', toPeer);
  doc.on('update', toNote);

  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'my-app/peer',
      // Already synced (a copy of the note), and no undo: a peer never undoes.
      dependencies: [
        RichTextExtension,
        configExtension(YCollabExtension, {
          doc,
          schemaVersion: 1, // the same as the note's other clients
          synced: true,
          captureTimeout: null,
        }),
      ],
    }),
  );
  return {
    doc,
    /** Edits as the peer: its writes reach the note before this returns. */
    edit(fn: () => void) {
      editor.update(fn, { discrete: true });
    },
    /** Leaves; what it wrote stays. */
    dispose() {
      note.off('update', toPeer);
      doc.off('update', toNote);
      editor.dispose();
      doc.destroy();
    },
  };
}
