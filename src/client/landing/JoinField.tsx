import * as stylex from '@stylexjs/stylex';
import { type FormEvent, useState } from 'react';

import { notePath, shortNoteId } from '../../shared/ids';
import { parseNoteInput } from '../../shared/links';
import { navigate } from '../router';
import { colors, fonts } from '../theme/tokens.stylex';

const styles = stylex.create({
  join: {
    maxWidth: 360,
    marginTop: 22,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: {
      default: colors['--rule'],
      ':focus-within': colors['--accent'],
    },
  },
  rowInvalid: {
    borderBottomColor: colors['--bad'],
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    minWidth: 0,
    height: 36,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors['--ink'],
    font: 'inherit',
    fontSize: 14,
    outlineStyle: 'none',
    '::placeholder': {
      color: colors['--muted'],
    },
  },
  open: {
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 6,
    color: {
      default: colors['--accent'],
      ':disabled': colors['--muted'],
    },
    fontSize: 13,
    fontWeight: 600,
    cursor: {
      default: 'pointer',
      ':disabled': 'default',
    },
  },
  hint: {
    minHeight: '1.45em',
    marginTop: 6,
    marginInline: 0,
    marginBottom: 0,
    color: colors['--muted'],
    fontSize: 13,
    lineHeight: 1.45,
  },
  hintValid: {
    color: colors['--ok'],
  },
  hintInvalid: {
    color: colors['--bad'],
  },
  code: {
    fontFamily: fonts['--mono'],
    fontSize: '0.92em',
  },
});

/** Paste a jot link or a code, on one quiet line; says in place which note it opens. */
export function JoinField() {
  const [value, setValue] = useState('');
  const id = parseNoteInput(value, window.location.host);
  const state = value.trim() === '' ? 'empty' : id === null ? 'invalid' : 'valid';

  const open = (event: FormEvent) => {
    event.preventDefault();
    if (id !== null) {
      navigate(notePath(id));
    }
  };

  return (
    <form {...stylex.props(styles.join)} onSubmit={open} noValidate>
      <div {...stylex.props(styles.row, state === 'invalid' && styles.rowInvalid)}>
        <input
          {...stylex.props(styles.input)}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Or paste a note link to join it."
          aria-label="Note link or code"
          aria-invalid={state === 'invalid'}
          aria-describedby="join-hint"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" {...stylex.props(styles.open)} disabled={state !== 'valid'}>
          Open
        </button>
      </div>
      <p
        id="join-hint"
        {...stylex.props(
          styles.hint,
          state === 'valid' && styles.hintValid,
          state === 'invalid' && styles.hintInvalid,
        )}
        aria-live="polite"
      >
        {state === 'valid' && id !== null && (
          <>
            Opens note <span {...stylex.props(styles.code)}>{shortNoteId(id)}</span>
          </>
        )}
        {state === 'invalid' && "That isn't a note link or code."}
      </p>
    </form>
  );
}
