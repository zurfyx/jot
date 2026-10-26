import { editsWaiting, formatBytes } from './format';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

type Tone = 'ok' | 'muted' | 'warn' | 'bad';

/** What the pill says, and in which tone (the dot repeats it). */
export function useNoteStatus(session: NoteSession): { label: string; tone: Tone } {
  const noteId = useSignal(session.noteId);
  const status = useSignal(session.status);
  const connection = useSignal(session.connection);
  const everSynced = useSignal(session.everSynced);
  const confirmed = useSignal(session.confirmed);
  const hasLocalContent = useSignal(session.hasLocalContent);
  const cap = useSignal(session.cap);
  const bytes = useSignal(session.bytes);
  const workOffline = useSignal(session.workOffline);
  const pending = useSignal(session.pendingEdits);
  const merged = useSignal(session.merged);
  const size = formatBytes(bytes);
  const near = cap === 'warn' ? 'warn' : 'ok';

  if (status === 'readonly') {
    return { label: 'Read only', tone: 'warn' };
  }
  if (cap === 'full') {
    return { label: `Full · ${size}`, tone: 'bad' };
  }
  if (noteId === null) {
    return { label: 'Only on this device', tone: near };
  }
  if (workOffline || (connection === 'offline' && (everSynced || hasLocalContent))) {
    return { label: `Offline · ${editsWaiting(pending)}`, tone: 'muted' };
  }
  if (!confirmed && pending > 0) {
    // Connected, and the server has not confirmed these edits yet.
    return { label: `Syncing · ${editsWaiting(pending)}`, tone: 'muted' };
  }
  if (!confirmed || status === 'pending') {
    return { label: 'Connecting…', tone: 'muted' };
  }
  if (merged) {
    return { label: 'Back online · merged', tone: near };
  }
  return { label: `Synced · ${size}`, tone: near };
}

/**
 * The note's state and Yjs size. On a shared note, a click toggles Work
 * offline; a Reconnect button sits beside it while offline is on.
 */
export function StatusPill({ session }: { session: NoteSession }) {
  const { label, tone } = useNoteStatus(session);
  const noteId = useSignal(session.noteId);
  const status = useSignal(session.status);
  const workOffline = useSignal(session.workOffline);
  const canToggle = noteId !== null && status !== 'readonly';

  return (
    <>
      <button
        type="button"
        className={`pill pill-${tone}`}
        data-testid="status-pill"
        aria-pressed={canToggle ? workOffline : undefined}
        title={canToggle ? (workOffline ? 'Reconnect' : 'Work offline') : undefined}
        disabled={!canToggle}
        onClick={() => session.setWorkOffline(!workOffline)}
      >
        <span className="pill-dot" aria-hidden="true" />
        <span key={label} className="pill-label" aria-live="polite">
          {label}
        </span>
      </button>
      {workOffline && (
        <button
          type="button"
          className="button-small reconnect"
          onClick={() => session.setWorkOffline(false)}
        >
          Reconnect
        </button>
      )}
    </>
  );
}
