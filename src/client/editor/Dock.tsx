import { IconButton } from '@astryxdesign/core/IconButton';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { currentTheme, setTheme, subscribeTheme } from '../theme';
import { colors } from '../theme/tokens.stylex';
import { copyNoteLink, startNewNote } from './actions';
import { astryxButtonReset, dockButton, nativeTitle } from './dock.styles';
import { NOTE_FEATURES } from './features';
import { formatBytes } from './format';
import { FormatMenu } from './FormatMenu';
import { Icon } from './icons';
import {
  MenuItem,
  MenuSeparator,
  MenuToggle,
  moveMenuFocus,
  popoverProps,
  useFocusFirstItem,
  usePopover,
} from './menu';
import { NoteInfo } from './NoteInfo';
import type { NoteSession } from './session';
import { useEditable, useSignal } from './useSignal';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const COPY_LINK_HINT = isMac ? '⌘⇧C' : 'Ctrl+Shift+C';

const styles = stylex.create({
  /** One floating row at the bottom, centred; only the dock itself takes the pointer. */
  wrap: {
    position: 'fixed',
    right: 0,
    bottom: 'max(18px, env(safe-area-inset-bottom))',
    left: 0,
    zIndex: 25,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  dock: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: 5,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 14,
    backgroundColor: colors['--bg'],
    boxShadow: `0 10px 30px ${colors['--shadow-soft']}`,
    pointerEvents: 'auto',
  },
  slot: {
    display: 'contents',
  },
});

/** `panel:<feature id>`: a feature's ⋯ panel (NoteFeature.menuPanel). */
type Open = 'format' | 'more' | 'info' | `panel:${string}`;

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
    <div {...stylex.props(styles.wrap)}>
      <div
        ref={dockRef}
        {...stylex.props(styles.dock)}
        data-dock=""
        role="toolbar"
        aria-label="Note"
        data-testid="dock"
      >
        <button
          type="button"
          {...stylex.props(dockButton.base)}
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
        <span {...stylex.props(styles.slot)} onPointerDown={() => open !== null && close()}>
          {NOTE_FEATURES.map(
            ({ id, dockStart: Item }) => Item && <Item key={id} session={session} />,
          )}
          {NOTE_FEATURES.map(
            ({ id, dockEnd: Item }) => Item && <Item key={id} session={session} />,
          )}
        </span>
        <IconButton
          label="More"
          variant="ghost"
          icon={<Icon name="more" />}
          xstyle={[astryxButtonReset.reset, dockButton.base, dockButton.iconOnly]}
          aria-haspopup="menu"
          aria-expanded={open !== null && open !== 'format'}
          {...nativeTitle('More')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) =>
            open !== null && open !== 'format' && open !== 'more'
              ? close()
              : toggle('more', event.detail)
          }
        />

        {open === 'format' && editable && (
          <FormatMenu session={session} viaKeyboard={viaKeyboard} close={close} />
        )}
        {open === 'more' && (
          <MoreMenu
            session={session}
            viaKeyboard={viaKeyboard}
            close={close}
            showInfo={() => setOpen('info')}
            showPanel={(id) => setOpen(`panel:${id}`)}
          />
        )}
        {open === 'info' && <NoteInfo session={session} viaKeyboard={viaKeyboard} />}
        {NOTE_FEATURES.map(
          ({ id, menuPanel }) =>
            menuPanel &&
            open === `panel:${id}` && (
              <menuPanel.Panel key={id} session={session} viaKeyboard={viaKeyboard} />
            ),
        )}
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
  showPanel,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
  close: () => void;
  showInfo: () => void;
  showPanel: (featureId: string) => void;
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
      {...popoverProps()}
      role="menu"
      aria-label="More"
      onKeyDown={moveMenuFocus}
      onMouseDown={(event) => event.preventDefault()}
    >
      {NOTE_FEATURES.map(
        ({ id, menuTop: Top }) => Top && <Top key={id} session={session} close={close} />,
      )}
      <MenuItem icon="info" label="Note info" hint={formatBytes(bytes)} onSelect={showInfo} />
      {NOTE_FEATURES.map(
        ({ id, menuPanel }) =>
          menuPanel && <menuPanel.Item key={id} session={session} open={() => showPanel(id)} />,
      )}
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
