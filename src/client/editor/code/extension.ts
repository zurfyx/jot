import { $isCodeNode } from '@lexical/code-core';
import {
  $getNodeByKey,
  defineExtension,
  type EditorState,
  type LexicalEditor,
  type NodeKey,
  safeCast,
} from 'lexical';

/** What the highlighter's chunk (`highlight.ts`) gives: `@lexical/code-prism`'s registration. */
export interface CodeHighlighter {
  registerCodeHighlighting: (editor: LexicalEditor) => () => void;
}

export interface CodeHighlightConfig {
  disabled: boolean;
  /** Fetches the highlighter. Tests pass their own. */
  load: () => Promise<CodeHighlighter>;
}

let loading: Promise<CodeHighlighter> | null = null;

/** The highlighter's chunk, fetched once per page; a failed fetch (offline) is tried again. */
function loadHighlighter(): Promise<CodeHighlighter> {
  loading ??= import('./highlight').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Whether any of `keys` is a code block in `state`. */
function hasCodeBlock(state: EditorState, keys: Iterable<NodeKey>): boolean {
  return state.read(() => {
    for (const key of keys) {
      if ($isCodeNode($getNodeByKey(key))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Syntax highlighting for code blocks, with `@lexical/code-prism` fetched the
 * first time the note holds a code block: a note without one never loads it
 * (D35). The highlighter is fetched and runs only while the editor is
 * editable, since it writes its tokens to the note; a read-only note shows
 * the tokens its writers stored.
 *
 * An update listener notices the first code block among the nodes a commit
 * changed, whether the note opened with one, a collaborator added one or
 * this person typed ```. Not a transform: `@lexical/y` applies what it reads
 * from the note without running transforms.
 *
 * The highlighter's tokens are part of the note, written by whoever edits a
 * block (D35). `@lexical/y` doesn't write the pass Lexical makes over the
 * existing nodes when the highlighter registers (no one edited them), so a
 * block a jot without the highlighter wrote shows as stored until someone
 * edits it, and code typed before the highlighter arrived is highlighted with
 * the next keystroke in its block.
 */
export const CodeHighlightExtension = defineExtension({
  name: 'jot/code-highlight',
  config: safeCast<CodeHighlightConfig>({ disabled: false, load: loadHighlighter }),
  register: (editor, { disabled, load }) => {
    if (disabled) {
      return () => {};
    }
    let disposed = false;
    let highlighter: CodeHighlighter | null = null;
    let unregisterHighlighting: (() => void) | null = null;
    let requested = false;
    let sawCode = false;

    const sync = () => {
      const wanted = highlighter !== null && !disposed && editor.isEditable();
      if (wanted && unregisterHighlighting === null && highlighter !== null) {
        unregisterHighlighting = highlighter.registerCodeHighlighting(editor);
      } else if (!wanted && unregisterHighlighting !== null) {
        unregisterHighlighting();
        unregisterHighlighting = null;
      }
    };

    // Fetched once the note has held a code block while editable: a
    // read-only note shows its stored tokens and needs no highlighter.
    const request = () => {
      if (requested || !sawCode || disposed || !editor.isEditable()) {
        return;
      }
      requested = true;
      load().then(
        (loaded) => {
          highlighter = loaded;
          sync();
        },
        () => {
          // Try again with the next change to a code block.
          requested = false;
        },
      );
    };

    const state = editor.getEditorState();
    sawCode = hasCodeBlock(state, state._nodeMap.keys());
    request();
    const stopWatching = editor.registerUpdateListener(
      ({ editorState, prevEditorState, dirtyElements, dirtyLeaves }) => {
        if (requested) {
          return;
        }
        // A whole new state (setEditorState) comes with no dirty nodes.
        const replaced =
          dirtyElements.size === 0 && dirtyLeaves.size === 0 && editorState !== prevEditorState;
        const keys = replaced ? editorState._nodeMap.keys() : dirtyElements.keys();
        if (hasCodeBlock(editorState, keys)) {
          sawCode = true;
          request();
        }
      },
    );
    const stopEditable = editor.registerEditableListener(() => {
      sync();
      request();
    });

    return () => {
      disposed = true;
      stopWatching();
      stopEditable();
      sync();
    };
  },
});
