import { $getRoot } from 'lexical';
import { useEffect } from 'react';

import { isExampleCreator } from '../examples';
import { recentNotes } from '../recent';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/**
 * Keeps this note in the browser's recent notes (D30): the visit is recorded
 * when the page opens, and once the note has synced its first line becomes
 * the title. A change to the note's content only marks the title stale; the
 * text is read when a write runs (the throttle lets one through at most every
 * 2 s; the page hidden or closed, or left, flushes one), inside the lock, so
 * a write that waited writes the latest text. Leaving the note writes its
 * last title at once and disposes the recorder, so a write still queued from
 * this editor writes nothing. Selection-only updates (caret moves, a peer's
 * caret) are ignored.
 */
export function useRecentVisit(session: NoteSession): void {
  const synced = useSignal(session.everSynced);

  useEffect(() => {
    void recentNotes.recordOpen(session.noteId, { example: isExampleCreator(session.noteId) });
  }, [session]);

  useEffect(() => {
    // Before the first sync the editor is empty, whatever the note holds.
    if (!synced) {
      return;
    }
    const { editor } = session;
    // Called when a write runs; the recorder stops calling it once disposed.
    const readNote = (): [string, string] | null => {
      try {
        return editor.getEditorState().read(() => {
          const [first, ...rest] = $getRoot().getChildren();
          let excerpt = '';
          for (const node of rest) {
            excerpt = `${excerpt} ${node.getTextContent()}`;
            if (excerpt.length > 200) {
              break;
            }
          }
          return [first?.getTextContent() ?? '', excerpt];
        });
      } catch {
        return null;
      }
    };
    const recorder = recentNotes.titleRecorder(session.noteId, readNote);
    recorder.changed();
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
        recorder.changed();
      }
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        recorder.flush();
      }
    };
    // The page may be gone before a lock is granted: write at once.
    const onPageHide = () => recorder.flush({ sync: true });
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      // Leaving the note: its last title is written now, before the editor
      // goes, and nothing from this editor is written after it.
      recorder.dispose();
    };
  }, [session, synced]);
}
