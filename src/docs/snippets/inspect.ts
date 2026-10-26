import { describeStorage } from '@lexical/y';
import type * as Y from '@y/y';
import type { LexicalEditor } from 'lexical';

export function logStorage(editor: LexicalEditor, doc: Y.Doc) {
  // How each node type is stored: 'line', 'group', 'format', 'nested' or 'text'.
  console.table(describeStorage(editor));

  // The note itself: text, ¶ line markers and nested nodes, with attributes.
  const root = doc.get('lexical-y');
  console.log(JSON.stringify(root.toDelta({ deep: true }), null, 2));
}
