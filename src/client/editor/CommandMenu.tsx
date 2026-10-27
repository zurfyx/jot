import { INSERT_TABLE_COMMAND } from '@lexical/table';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useRef, useState } from 'react';

import { navigate } from '../router';
import { toggleTheme } from '../theme';
import { colors, motion } from '../theme/tokens.stylex';
import { copyNoteLink, startNewNote } from './actions';
import { isMac } from './Dock';
import type { NoteSession } from './session';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

const menuIn = stylex.keyframes({
  from: { opacity: 0, transform: 'translate(-50%, -6px)' },
});

const styles = stylex.create({
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 40,
    backgroundColor: colors['--scrim'],
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  menu: {
    position: 'fixed',
    top: '18vh',
    left: '50%',
    width: 'min(520px, calc(100vw - 32px))',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: '12px',
    backgroundColor: colors['--bg'],
    boxShadow: `0 16px 48px ${colors['--shadow']}`,
    transform: 'translateX(-50%)',
    animationName: menuIn,
    animationDuration: motion['--pop'],
    animationTimingFunction: motion['--ease'],
  },
  input: {
    width: '100%',
    paddingBlock: '15px',
    paddingInline: '16px',
    borderWidth: 0,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--rule'],
    backgroundColor: 'transparent',
    color: colors['--ink'],
    font: 'inherit',
    fontSize: '15px',
    outlineStyle: 'none',
    '::placeholder': {
      color: colors['--muted'],
    },
  },
  list: {
    margin: 0,
    padding: '6px',
    listStyleType: 'none',
  },
  item: {
    paddingBlock: '9px',
    paddingInline: '10px',
    borderRadius: '7px',
    fontSize: '14.5px',
    cursor: 'pointer',
  },
  selected: {
    backgroundColor: colors['--hover'],
  },
  empty: {
    color: colors['--muted'],
    cursor: 'default',
  },
});

/** ⌘K: a small menu that performs actions. */
export function CommandMenu({ session }: { session: NoteSession }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'new', label: 'New note', run: startNewNote },
      { id: 'copy', label: 'Copy link', run: () => void copyNoteLink(session) },
      { id: 'theme', label: 'Toggle theme', run: toggleTheme },
      {
        id: 'table',
        label: 'Insert table',
        run: () => {
          session.editor.focus();
          session.editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns: '3',
            rows: '3',
            includeHeaders: { rows: true, columns: false },
          });
        },
      },
      { id: 'home', label: 'Go home', run: () => navigate('/') },
    ],
    [session],
  );

  const visible = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setIndex(0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const close = () => {
    setOpen(false);
    session.editor.focus();
  };
  const run = (command: Command | undefined) => {
    if (command === undefined) {
      return;
    }
    setOpen(false);
    if (command.id !== 'table') {
      session.editor.focus();
    }
    command.run();
  };

  return (
    <div {...stylex.props(styles.scrim)} onMouseDown={close} data-command-scrim="">
      <div
        {...stylex.props(styles.menu)}
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          {...stylex.props(styles.input)}
          value={query}
          placeholder="Type a command"
          aria-label="Command"
          aria-controls="command-list"
          aria-activedescendant={visible[index] ? `command-${visible[index].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, visible.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(visible[index]);
            }
          }}
        />
        <ul {...stylex.props(styles.list)} id="command-list" role="listbox">
          {visible.map((command, i) => (
            <li
              key={command.id}
              id={`command-${command.id}`}
              role="option"
              aria-selected={i === index}
              {...stylex.props(styles.item, i === index && styles.selected)}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(command)}
            >
              {command.label}
            </li>
          ))}
          {visible.length === 0 && (
            <li {...stylex.props(styles.item, styles.empty)}>No matching command</li>
          )}
        </ul>
      </div>
    </div>
  );
}
