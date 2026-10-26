import { type FormEvent, useState } from 'react';

import { notePath, shortNoteId } from '../../shared/ids';
import { parseNoteInput } from '../../shared/links';
import { navigate } from '../router';

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
    <form className="join" onSubmit={open} noValidate>
      <div className={`join-row is-${state}`}>
        <input
          className="join-input"
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
        <button type="submit" className="join-open" disabled={state !== 'valid'}>
          Open
        </button>
      </div>
      <p id="join-hint" className={`join-hint is-${state}`} aria-live="polite">
        {state === 'valid' && id !== null && (
          <>
            Opens note <span className="mono">{shortNoteId(id)}</span>
          </>
        )}
        {state === 'invalid' && "That isn't a note link or code."}
      </p>
    </form>
  );
}
