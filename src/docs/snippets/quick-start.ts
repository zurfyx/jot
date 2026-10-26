import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { RichTextExtension } from '@lexical/rich-text';
import { YCollabExtension } from '@lexical/y';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { configExtension, defineExtension } from 'lexical';

export function openNote(element: HTMLElement, id: string) {
  const doc = new Y.Doc();
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'my-app/note',
      dependencies: [RichTextExtension, configExtension(YCollabExtension, { doc })],
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  editor.setRootElement(element);

  // Any Yjs 14 provider works; jot's relay speaks the y-websocket protocol.
  const provider = new WebsocketProvider('wss://jot.rovira.sh/api/n', `${id}/ws`, doc);
  provider.on('sync', (synced: boolean) => {
    if (synced) binding.initialize(); // a no-op after the first time
  });
  return { doc, editor, provider };
}
