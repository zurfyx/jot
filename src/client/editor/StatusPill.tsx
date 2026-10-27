import * as stylex from '@stylexjs/stylex';

import { colors, motion } from '../theme/tokens.stylex';
import { buttonSmall } from './chrome.styles';
import { editsWaiting, formatBytes } from './format';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

type Tone = 'ok' | 'muted' | 'warn' | 'bad';

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

const styles = stylex.create({
  pill: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '7px',
    height: '30px',
    paddingBlock: 0,
    paddingInline: '10px',
    borderRadius: '999px',
    color: colors['--muted'],
    fontSize: '13px',
    whiteSpace: 'nowrap',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'ease-out',
    backgroundColor: { default: null, ':hover': { default: null, ':enabled': colors['--hover'] } },
    cursor: { default: null, ':disabled': 'default' },
  },
  pressed: {
    backgroundColor: colors['--hover'],
  },
  warn: {
    color: colors['--warn'],
  },
  bad: {
    color: colors['--bad'],
  },
  dot: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: colors['--muted'],
    transitionProperty: 'background-color',
    transitionDuration: motion['--enter'],
    transitionTimingFunction: motion['--ease'],
  },
  dotOk: {
    backgroundColor: colors['--ok'],
  },
  dotWarn: {
    backgroundColor: colors['--warn'],
  },
  dotBad: {
    backgroundColor: colors['--bad'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  reconnect: {
    height: '28px',
    paddingInline: '10px',
    fontSize: '12.5px',
    backgroundColor: { default: colors['--btn'], ':hover': colors['--accent'] },
    color: colors['--btn-ink'],
  },
});

/** What the pill says, and in which tone (the dot repeats it). */
export function useNoteStatus(session: NoteSession): { label: string; tone: Tone } {
  const status = useSignal(session.status);
  const connection = useSignal(session.connection);
  const everSynced = useSignal(session.everSynced);
  const confirmed = useSignal(session.confirmed);
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
  if (workOffline || (connection === 'offline' && everSynced)) {
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
 * The note's state and Yjs size. A click toggles Work offline; a Reconnect button sits beside it while offline is on.
 */
export function StatusPill({ session }: { session: NoteSession }) {
  const { label, tone } = useNoteStatus(session);
  const status = useSignal(session.status);
  const workOffline = useSignal(session.workOffline);
  const canToggle = status !== 'readonly';

  return (
    <>
      <button
        type="button"
        {...stylex.props(
          styles.pill,
          canToggle && workOffline && styles.pressed,
          tone === 'warn' && styles.warn,
          tone === 'bad' && styles.bad,
        )}
        data-testid="status-pill"
        aria-pressed={canToggle ? workOffline : undefined}
        title={canToggle ? (workOffline ? 'Reconnect' : 'Work offline') : undefined}
        disabled={!canToggle}
        onClick={() => session.setWorkOffline(!workOffline)}
      >
        <span
          {...stylex.props(
            styles.dot,
            tone === 'ok' && styles.dotOk,
            tone === 'warn' && styles.dotWarn,
            tone === 'bad' && styles.dotBad,
          )}
          aria-hidden="true"
        />
        <span key={label} {...stylex.props(styles.label)} aria-live="polite">
          {label}
        </span>
      </button>
      {workOffline && (
        <button
          type="button"
          {...stylex.props(buttonSmall.base, styles.reconnect)}
          onClick={() => session.setWorkOffline(false)}
        >
          Reconnect
        </button>
      )}
    </>
  );
}
