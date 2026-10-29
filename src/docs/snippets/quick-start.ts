import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { RichTextExtension } from '@lexical/rich-text';
import { createYDoc, YCollabExtension } from '@lexical/y';
import { WebsocketProvider } from '@y/websocket';
import { configExtension, defineExtension } from 'lexical';
import * as decoding from 'lib0/decoding';

import { isNoteId } from '../../shared/ids';
import { MESSAGE_NOTE_STATUS } from '../../shared/protocol';

export function openNote(element: HTMLElement, id: string) {
  // jot's relay only opens 22-character note ids; anything else is a 400.
  if (!isNoteId(id)) throw new Error('Not a jot note id');
  const doc = createYDoc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'my-app/note',
      dependencies: [
        RichTextExtension,
        configExtension(YCollabExtension, { doc, schemaVersion: 1 }),
      ],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  editor.setRootElement(element);

  const provider = new WebsocketProvider('wss://jot.rovira.sh/api/n', `${id}/ws`, doc);
  // The relay speaks y-websocket plus one message of its own: the note's size.
  provider.messageHandlers[MESSAGE_NOTE_STATUS] = (_encoder, decoder) => {
    decoding.readVarUint(decoder); // stored bytes
    decoding.readVarUint(decoder); // flags: 1 when an update was refused
  };
  provider.on('sync', (synced: boolean) => {
    if (synced) binding.initialize(); // a no-op after the first time
  });
  return { doc, editor, provider };
}
