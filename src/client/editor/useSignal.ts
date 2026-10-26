import type { ReadonlySignal } from '@lexical/extension';
import type { LexicalEditor } from 'lexical';
import { useSyncExternalStore } from 'react';

/** Reads a signal and re-renders when it changes. */
export function useSignal<T>(source: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (onChange) => source.subscribe(() => onChange()),
    () => source.value,
  );
}

/** Whether the editor is editable (read only notes, full notes and pending bindings aren't). */
export function useEditable(editor: LexicalEditor): boolean {
  return useSyncExternalStore(
    (onChange) => editor.registerEditableListener(onChange),
    () => editor.isEditable(),
  );
}
