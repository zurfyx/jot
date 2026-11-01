import { $getRoot } from 'lexical';
import { useEffect } from 'react';

import { isExampleCreator } from '../examples';
import { recentNotes } from '../recent';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/**
 * Keeps this note in the browser's recent notes (D30): the visit is recorded
 * when the page opens, and once the note has synced its first line becomes
 * the title as you type (throttled), written out at once when the page is
 * hidden or closed and when you leave it.
 */
export function useRecentVisit(session: NoteSession): void {
  const synced = useSignal(session.everSynced);

  useEffect(() => {
    recentNotes.recordOpen(session.noteId, { example: isExampleCreator(session.noteId) });
  }, [session]);

  useEffect(() => {
    // Before the first sync the editor is empty, whatever the note holds.
    if (!synced) {
      return;
    }
    const { editor } = session;
    const recorder = recentNotes.titleRecorder(session.noteId);
    const read = () =>
      editor.getEditorState().read(() => {
        const [first, ...rest] = $getRoot().getChildren();
        let excerpt = '';
        for (const node of rest) {
          excerpt = `${excerpt} ${node.getTextContent()}`;
          if (excerpt.length > 200) {
            break;
          }
        }
        recorder.update(first?.getTextContent() ?? '', excerpt);
      });
    read();
    const unregister = editor.registerUpdateListener(read);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        recorder.flush();
      }
    };
    const onPageHide = () => recorder.flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      recorder.flush();
    };
  }, [session, synced]);
}
