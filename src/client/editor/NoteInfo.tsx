import { useEffect, useRef, useState } from 'react';

import { NOTE_MAX_BYTES } from '../../shared/limits';
import { formatBytes, keptUntil } from './format';
import { peerStyle, usePeople } from './people';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

/** Note info: the Yjs size against the cap, who is here, and how long it is kept. */
export function NoteInfo({ session, viaKeyboard }: { session: NoteSession; viaKeyboard: boolean }) {
  const bytes = useSignal(session.bytes);
  const cap = useSignal(session.cap);
  const noteId = useSignal(session.noteId);
  const people = usePeople(session);
  const ref = useRef<HTMLDivElement>(null);
  // Opening the note counts as a visit, so it is kept 90 days from now.
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    if (viaKeyboard) {
      ref.current?.focus();
    }
  }, [viaKeyboard]);
  const share = Math.min(1, bytes / NOTE_MAX_BYTES);

  return (
    <div
      ref={ref}
      className="popover note-info"
      role="dialog"
      aria-label="Note info"
      tabIndex={-1}
      data-testid="note-info"
    >
      <h2 className="note-info-title">This note</h2>

      <h3 className="note-info-key">Yjs size</h3>
      <p className="note-info-size">
        <span data-testid="note-info-size">{formatBytes(bytes)}</span>
        <span className="note-info-muted">of {formatBytes(NOTE_MAX_BYTES)}</span>
      </p>
      <div
        className={`meter meter-${cap}`}
        role="meter"
        aria-label="Yjs size"
        aria-valuemin={0}
        aria-valuemax={NOTE_MAX_BYTES}
        aria-valuenow={Math.min(bytes, NOTE_MAX_BYTES)}
        aria-valuetext={`${formatBytes(bytes)} of ${formatBytes(NOTE_MAX_BYTES)}`}
      >
        <span style={{ transform: `scaleX(${share})` }} />
      </div>

      <h3 className="note-info-key">Here now</h3>
      <ul className="note-info-people">
        {people.map((person) => (
          <li key={person.clientID} style={peerStyle(person.color)}>
            <span className="person-dot" aria-hidden="true" />
            <span className="person-name">
              {person.name}
              {person.self ? ' (you)' : ''}
            </span>
            <span className="note-info-muted">{person.state}</span>
          </li>
        ))}
      </ul>

      <h3 className="note-info-key">Kept until</h3>
      <p className="note-info-line">
        {noteId === null
          ? 'Only in this browser until you share it'
          : `${keptUntil(openedAt)} · 90 days after the last visit`}
      </p>
    </div>
  );
}
