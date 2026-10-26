import { $getRoot, $isElementNode } from 'lexical';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { generateNoteId, notePath } from '../../shared/ids';
import { navigate } from '../router';
import { CommandMenu } from './CommandMenu';
import { RemoteCarets } from './RemoteCarets';
import { SelectionToolbar } from './SelectionToolbar';
import { createNoteSession, type NoteSession } from './session';
import { ShareButton } from './ShareButton';
import { StatusPill } from './StatusPill';
import { useSignal } from './useSignal';

export default function NotePage({ id }: { id: string }) {
  const [session, setSession] = useState<NoteSession | null>(null);

  useEffect(() => {
    // The session is an external system (socket, document, editor) whose
    // lifetime is this effect's; React state only hands it to the children.
    const created = createNoteSession(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [id]);

  return (
    <div className="note-page">
      <div className="note-chrome">
        {session && <StatusPill session={session} />}
        <ShareButton />
      </div>
      <main className="note-column">{session && <NoteBody session={session} />}</main>
      {session && <CommandMenu session={session} />}
    </div>
  );
}

function NoteBody({ session }: { session: NoteSession }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const status = useSignal(session.status);
  const cap = useSignal(session.cap);
  const empty = useEmptyAndTitle(session);
  const editable = useEditable(session);

  useEffect(() => {
    const { editor } = session;
    editor.setRootElement(rootRef.current);
    return () => editor.setRootElement(null);
  }, [session]);

  // Focus the page once the binding has read the note and it is writable.
  useEffect(() => {
    if (status === 'active' && cap !== 'full') {
      session.editor.focus();
    }
  }, [session, status, cap]);

  return (
    <>
      {status === 'readonly' && (
        <p className="note-banner" role="status">
          Read only. This note was written by a newer version of jot; reload to edit.
        </p>
      )}
      {cap === 'full' && (
        <p className="note-banner" role="status">
          This note is full.{' '}
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate(notePath(generateNoteId()));
            }}
          >
            Start a new note
          </a>{' '}
          to keep writing.
        </p>
      )}
      {cap === 'warn' && (
        <p className="note-notice" role="status">
          This note is almost full.
        </p>
      )}
      <div className="note-surface" ref={surfaceRef}>
        {empty && status === 'active' && (
          <div className="note-placeholder" aria-hidden="true">
            <p className="note-placeholder-title">Untitled</p>
            <p>Start writing. Anyone with this link can edit.</p>
          </div>
        )}
        <div
          className="jot-editor"
          ref={rootRef}
          contentEditable={editable}
          suppressContentEditableWarning
          aria-readonly={!editable}
          role="textbox"
          aria-multiline="true"
          aria-label="Note"
          spellCheck
          data-testid="editor"
        />
        <RemoteCarets session={session} surfaceRef={surfaceRef} />
      </div>
      <SelectionToolbar session={session} />
    </>
  );
}

/** Lexical tracks editability; the root element's attribute follows it. */
function useEditable(session: NoteSession): boolean {
  const { editor } = session;
  return useSyncExternalStore(
    (onChange) => editor.registerEditableListener(onChange),
    () => editor.isEditable(),
  );
}

/** Whether the note is empty, and keeps document.title on its first line. */
function useEmptyAndTitle(session: NoteSession): boolean {
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const { editor } = session;
    const read = () =>
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const first = root.getFirstChild();
        const title = first?.getTextContent().trim() ?? '';
        document.title = `${title === '' ? 'Untitled' : title.slice(0, 80)} · jot`;
        const isEmpty =
          root.getChildrenSize() <= 1 &&
          (first === null || ($isElementNode(first) && first.getType() === 'paragraph')) &&
          root.getTextContent() === '';
        setEmpty(isEmpty);
      });
    read();
    return editor.registerUpdateListener(read);
  }, [session]);
  return empty;
}
