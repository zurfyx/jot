import { $getRoot, $isElementNode } from 'lexical';
import { useEffect, useRef, useState } from 'react';

import { copyNoteLink, startNewNote } from './actions';
import { registerClickToFocus } from './clickToFocus';
import { CommandMenu } from './CommandMenu';
import { Dock, isMac } from './Dock';
import { NOTE_FEATURES } from './features';
import { Avatars } from './people';
import { RemoteCarets } from './RemoteCarets';
import { pushLegacyCopies } from './legacy';
import { createNoteSession, type NoteSession } from './session';
import { ShareButton } from './ShareButton';
import { StatusPill } from './StatusPill';
import { useEditable, useSignal } from './useSignal';

/** A note page: note `id`, shared through the relay (D23). */
export default function NotePage({ id }: { id: string }) {
  const [session, setSession] = useState<NoteSession | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The session is an external system (socket, document, editor) whose
    // lifetime is this effect's; React state only hands it to the children.
    const created = createNoteSession(id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(created);
    // Notes an earlier version of jot kept in this browser go to the relay.
    pushLegacyCopies();
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [id]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (isMac ? event.metaKey : event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'c'
      ) {
        event.preventDefault();
        void copyNoteLink(session);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  // A click on the blank page puts the caret in the note.
  useEffect(() => {
    const page = pageRef.current;
    if (session === null || page === null) {
      return;
    }
    return registerClickToFocus(page, session.editor);
  }, [session]);

  return (
    <div className="note-page" ref={pageRef}>
      <header className="note-chrome">
        {session && (
          <>
            <Avatars session={session} />
            <StatusPill session={session} />
            <ShareButton session={session} />
          </>
        )}
      </header>
      <main className="note-column">{session && <NoteBody session={session} />}</main>
      {session && <Dock session={session} />}
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
  const editable = useEditable(session.editor);

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
            href="/new"
            onClick={(event) => {
              event.preventDefault();
              startNewNote();
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
      {NOTE_FEATURES.map(
        ({ id, banner: Banner }) => Banner && <Banner key={id} session={session} />,
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
        {NOTE_FEATURES.map(
          ({ id, surface: Surface }) =>
            Surface && <Surface key={id} session={session} surfaceRef={surfaceRef} />,
        )}
      </div>
    </>
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
