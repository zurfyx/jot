import { useEffect, useState } from 'react';

import type { NoteSession } from './session';
import { useSignal } from './useSignal';

type Tone = 'ok' | 'muted' | 'warn';

function usePeopleHere(session: NoteSession): number {
  const { awareness } = session.provider;
  const [count, setCount] = useState(() => awareness.getStates().size);
  useEffect(() => {
    const update = () => setCount(awareness.getStates().size);
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness]);
  return count;
}

export function StatusPill({ session }: { session: NoteSession }) {
  const status = useSignal(session.status);
  const connection = useSignal(session.connection);
  const synced = useSignal(session.synced);
  const everSynced = useSignal(session.everSynced);
  const cap = useSignal(session.cap);
  const here = usePeopleHere(session);

  let label: string;
  let tone: Tone;
  if (status === 'readonly' || cap === 'full') {
    label = 'Read only';
    tone = 'warn';
  } else if (connection === 'offline' && everSynced) {
    label = 'Offline · will sync when you reconnect';
    tone = 'muted';
  } else if (!synced || status === 'pending') {
    label = 'Connecting…';
    tone = 'muted';
  } else {
    label = `Synced · ${here} here`;
    tone = 'ok';
  }

  return (
    <span className="pill" role="status" aria-live="polite" data-testid="status-pill">
      <span className={`pill-dot pill-dot-${tone}`} aria-hidden="true" />
      <span key={label} className="pill-label">
        {label}
      </span>
    </span>
  );
}
