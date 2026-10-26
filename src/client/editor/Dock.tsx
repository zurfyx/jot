import { useEffect, useRef, useSyncExternalStore } from 'react';

import { currentTheme, setTheme, subscribeTheme } from '../theme';
import { copyNoteLink, startNewNote } from './actions';
import { NOTE_FEATURES } from './features';
import { formatBytes } from './format';
import { FormatMenu } from './FormatMenu';
import { Icon } from './icons';
import {
  MenuItem,
  MenuSeparator,
  MenuToggle,
  moveMenuFocus,
  useFocusFirstItem,
  usePopover,
} from './menu';
import { NoteInfo } from './NoteInfo';
import type { NoteSession } from './session';
import { useEditable, useSignal } from './useSignal';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const COPY_LINK_HINT = isMac ? '⌘⇧C' : 'Ctrl+Shift+C';

type Open = 'format' | 'more' | 'info';

/**
 * The floating dock at the bottom: Aa · ⋯, with room for features between
 * them (NOTE_FEATURES: Ask AI, the blame chip).
 */
export function Dock({ session }: { session: NoteSession }) {
  const dockRef = useRef<HTMLDivElement>(null);
  const editable = useEditable(session.editor);
  const { open, setOpen, viaKeyboard, close, toggle } = usePopover<Open>(dockRef, () => {
    // Focus goes back to the page rather than to a control that closed.
    if (dockRef.current?.contains(document.activeElement)) {
      session.editor.focus();
    }
  });
  // A note that turns read only (full, or a newer layout) closes Aa at once.
  useEffect(() => {
    if (!editable && open === 'format') {
      close();
    }
  }, [editable, open, close]);

  return (
    <div className="dock-wrap">
      <div ref={dockRef} className="dock" role="toolbar" aria-label="Note" data-testid="dock">
        <button
          type="button"
          className="dock-button"
          aria-label="Format"
          aria-haspopup="menu"
          aria-expanded={open === 'format'}
          title={editable ? 'Format' : 'Format (this note is read only)'}
          disabled={!editable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => toggle('format', event.detail)}
        >
          Aa
        </button>
        {/* A press on a feature's control closes Aa or ⋯ (features run their own popovers). */}
        <span className="dock-slot" onPointerDown={() => open !== null && close()}>
          {NOTE_FEATURES.map(
            ({ id, dockStart: Item }) => Item && <Item key={id} session={session} />,
          )}
          {NOTE_FEATURES.map(
            ({ id, dockEnd: Item }) => Item && <Item key={id} session={session} />,
          )}
        </span>
        <button
          type="button"
          className="dock-button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={open === 'more' || open === 'info'}
          title="More"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => (open === 'info' ? close() : toggle('more', event.detail))}
        >
          <Icon name="more" />
        </button>

        {open === 'format' && editable && (
          <FormatMenu session={session} viaKeyboard={viaKeyboard} close={close} />
        )}
        {open === 'more' && (
          <MoreMenu
            session={session}
            viaKeyboard={viaKeyboard}
            close={close}
            showInfo={() => setOpen('info')}
          />
        )}
        {open === 'info' && <NoteInfo session={session} viaKeyboard={viaKeyboard} />}
      </div>
    </div>
  );
}

function useTheme() {
  return useSyncExternalStore(subscribeTheme, currentTheme);
}

function MoreMenu({
  session,
  viaKeyboard,
  close,
  showInfo,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
  close: () => void;
  showInfo: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bytes = useSignal(session.bytes);
  const status = useSignal(session.status);
  const workOffline = useSignal(session.workOffline);
  const theme = useTheme();
  useFocusFirstItem(ref, viaKeyboard);

  return (
    <div
      ref={ref}
      className="popover more-menu"
      role="menu"
      aria-label="More"
      onKeyDown={moveMenuFocus}
      onMouseDown={(event) => event.preventDefault()}
    >
      {NOTE_FEATURES.map(
        ({ id, menuTop: Top }) => Top && <Top key={id} session={session} close={close} />,
      )}
      <MenuItem icon="info" label="Note info" hint={formatBytes(bytes)} onSelect={showInfo} />
      <MenuToggle
        icon="offline"
        label="Work offline"
        checked={workOffline}
        disabled={status === 'readonly'}
        onChange={(on) => session.setWorkOffline(on)}
      />
      <MenuSeparator />
      <MenuItem
        icon="copy"
        label="Copy link"
        hint={COPY_LINK_HINT}
        onSelect={() => {
          close();
          void copyNoteLink(session);
        }}
      />
      <MenuItem
        icon="plus"
        label="New note"
        onSelect={() => {
          close();
          startNewNote();
        }}
      />
      <MenuToggle
        icon="moon"
        label="Dark theme"
        checked={theme === 'dark'}
        onChange={(dark) => setTheme(dark ? 'dark' : 'light')}
      />
    </div>
  );
}
