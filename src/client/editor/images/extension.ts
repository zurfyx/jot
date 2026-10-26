import {
  $getNearestNodeFromDOMNode,
  $createNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  defineExtension,
  isDOMNode,
} from 'lexical';

import { $isImageNode, ImageNode } from './ImageNode';

/**
 * Images in jot's editor (D26): the node, and a click on an image selects
 * it (Backspace and Delete then remove it; arrows leave it). Inserting is
 * the note page's job (`controller.ts`): uploads need the note.
 */
export const ImageExtension = defineExtension({
  name: 'jot/images',
  nodes: () => [ImageNode],
  register: (editor) =>
    editor.registerCommand(
      CLICK_COMMAND,
      (event: MouseEvent) => {
        const target = event.target;
        if (!isDOMNode(target) || !(target instanceof Element)) {
          return false;
        }
        // The alt field inside a selected image handles its own clicks.
        if (target.closest('.jot-image-alt') !== null || target.closest('.jot-image') === null) {
          return false;
        }
        const node = $getNearestNodeFromDOMNode(target);
        if (!$isImageNode(node)) {
          return false;
        }
        const selection = $createNodeSelection();
        selection.add(node.getKey());
        $setSelection(selection);
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
});

/** Paste images even when the clipboard also carries HTML (browsers add it when copying an image). */
export function shouldHandlePasteAsFiles(files: File[], hasTextContent: boolean): boolean {
  if (files.length === 0) {
    return false;
  }
  return !hasTextContent || files.some((file) => file.type.startsWith('image/'));
}
