import * as stylex from '@stylexjs/stylex';
import { $getRoot, $isElementNode } from 'lexical';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { copyNoteLink, startNewNote } from './actions';
import { registerClickToFocus } from './clickToFocus';
import { CommandMenu } from './CommandMenu';
import { Dock, isMac } from './Dock';
import { titleStyle } from './extensions';
import { NOTE_FEATURES } from './features';
import { Avatars } from './people';
import { RemoteCarets } from './RemoteCarets';
import { pushLegacyCopies } from './legacy';
import { createNoteSession, type NoteSession } from './session';
import { ShareButton } from './ShareButton';
import { StatusPill } from './StatusPill';
import { useEditable, useSignal } from './useSignal';
import { colors, motion } from '../theme/tokens.stylex';

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

const PHONE = '@media (max-width: 640px)';

/*
 * On <html> while a note shows the dock: typing at the bottom keeps the caret
 * line above the dock, because Lexical's scroll-into-view stops short of the
 * root's scroll-padding. The dock sits max(18px, safe area) from the bottom
 * and is 46px tall; 30px more clears it.
 */
const root = stylex.create({
  withDock: {
    scrollPaddingBottom: 'calc(max(18px, env(safe-area-inset-bottom)) + 76px)',
  },
});

/** Puts the note page's root style on <html>, beside its other classes, while `on`. */
function useRootStyle(on: boolean): void {
  useLayoutEffect(() => {
    if (!on) {
      return;
    }
    const classes = (stylex.props(root.withDock).className ?? '').split(' ').filter(Boolean);
    const html = document.documentElement;
    html.classList.add(...classes);
    return () => html.classList.remove(...classes);
  }, [on]);
}

const styles = stylex.create({
  /*
   * The page is exactly one window tall until the note outgrows it: the
   * column fills the page with its padding inside that height, and the editor
   * takes whatever the column leaves, so an empty note never scrolls. svh,
   * not dvh or vh: phones size the root's client height to the small
   * viewport, and a larger page would scroll by the toolbar's height.
   */
  page: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: stylex.firstThatWorks('100svh', '100vh'),
  },
  chrome: {
    position: 'fixed',
    top: { default: '12px', [PHONE]: '10px' },
    right: { default: '14px', [PHONE]: '10px' },
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: { default: 'calc(100vw - 28px)', [PHONE]: 'calc(100vw - 20px)' },
    padding: '2px',
    borderRadius: '10px',
    backgroundColor: colors['--bg'],
  },
  // The bottom padding lets the last line scroll up clear of the dock.
  column: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    flexDirection: 'column',
    width: '100%',
    maxWidth: '680px',
    marginBlock: 0,
    marginInline: 'auto',
    paddingTop: { default: '80px', [PHONE]: '68px' },
    paddingInline: { default: '32px', [PHONE]: '20px' },
    paddingBottom: stylex.firstThatWorks('45svh', '45vh'),
  },
  message: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: '20px',
    fontSize: '13.5px',
    lineHeight: 1.5,
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  // Read only and full stay in view while the page scrolls.
  banner: {
    position: 'sticky',
    top: '60px',
    zIndex: 10,
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '8px',
    backgroundColor: `color-mix(in srgb, ${colors['--warn']} 12%, ${colors['--bg']})`,
    color: colors['--warn'],
  },
  bannerLink: {
    color: 'inherit',
    fontWeight: 600,
  },
  notice: {
    color: colors['--muted'],
  },
  surface: {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    flexDirection: 'column',
  },
  placeholder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 'auto',
    left: 0,
    color: colors['--muted'],
    fontSize: { default: '18px', [PHONE]: '16px' },
    lineHeight: 1.65,
    pointerEvents: 'none',
    userSelect: 'none',
  },
  placeholderLine: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: '12px',
  },
});

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

  useRootStyle(session !== null);

  // A click on the blank page puts the caret in the note.
  useEffect(() => {
    const page = pageRef.current;
    if (session === null || page === null) {
      return;
    }
    return registerClickToFocus(page, session.editor);
  }, [session]);

  return (
    // data-note-page-root: present from the first render, before a session
    // exists; opening a note from the landing page waits for it (landing/open.ts).
    <div {...stylex.props(styles.page)} ref={pageRef} data-note-page-root="">
      <header {...stylex.props(styles.chrome)} data-own-press="">
        {session && (
          <>
            <Avatars session={session} />
            <StatusPill session={session} />
            <ShareButton session={session} />
          </>
        )}
      </header>
      <main {...stylex.props(styles.column)}>{session && <NoteBody session={session} />}</main>
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
        <p {...stylex.props(styles.message, styles.banner)} role="status" data-own-press="">
          Read only. This note was written by a newer version of jot; reload to edit.
        </p>
      )}
      {cap === 'full' && (
        <p {...stylex.props(styles.message, styles.banner)} role="status" data-own-press="">
          This note is full.{' '}
          <a
            {...stylex.props(styles.bannerLink)}
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
        <p {...stylex.props(styles.message, styles.notice)} role="status" data-own-press="">
          This note is almost full.
        </p>
      )}
      {NOTE_FEATURES.map(
        ({ id, banner: Banner }) => Banner && <Banner key={id} session={session} />,
      )}
      <div {...stylex.props(styles.surface)} ref={surfaceRef}>
        {empty && status === 'active' && (
          <div {...stylex.props(styles.placeholder)} aria-hidden="true" data-testid="placeholder">
            <p {...stylex.props(titleStyle)}>Untitled</p>
            <p {...stylex.props(styles.placeholderLine)}>
              Start writing. Anyone with this link can edit.
            </p>
          </div>
        )}
        {/* Its classes come from the editor's theme (extensions.ts), which the docs' inspector shares. */}
        <div
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
