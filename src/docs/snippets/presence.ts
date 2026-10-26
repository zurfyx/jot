import { createDOMRange } from '@lexical/selection';
import type { YBinding, YCursor } from '@lexical/y';
import type { Awareness } from '@y/protocols/awareness';
import type { LexicalEditor } from 'lexical';

/** Publish who you are and where your selection is, as Yjs relative positions. */
export function publishPresence(editor: LexicalEditor, binding: YBinding, awareness: Awareness) {
  awareness.setLocalStateField('user', { name: 'Ana', color: 1 });
  return editor.registerUpdateListener(() => {
    awareness.setLocalStateField('cursor', binding.getCursor());
  });
}

/** Resolve everyone else's cursor against this document, as DOM ranges to draw. */
export function remoteRanges(editor: LexicalEditor, binding: YBinding, awareness: Awareness) {
  const ranges: { name: string; range: Range }[] = [];
  editor.getEditorState().read(
    () => {
      for (const [clientID, state] of awareness.getStates()) {
        const cursor = state.cursor as YCursor | null | undefined;
        if (clientID === awareness.clientID || cursor == null) continue;
        const points = binding.$resolveCursor(cursor); // null if the text is gone
        if (points === null) continue;
        const range = createDOMRange(
          editor,
          points.anchor.getNode(),
          points.anchor.offset,
          points.focus.getNode(),
          points.focus.offset,
        );
        if (range !== null) ranges.push({ name: String(state.user?.name), range });
      }
    },
    { editor },
  );
  return ranges;
}
