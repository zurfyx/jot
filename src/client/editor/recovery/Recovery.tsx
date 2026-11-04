import { buildEditorFromExtensions } from '@lexical/extension';
import { type ReadonlySignal, signal } from '@lexical/extension';
import * as stylex from '@stylexjs/stylex';
import {
  configExtension,
  defineExtension,
  type LexicalEditorWithDispose,
  type SerializedEditorState,
} from 'lexical';
import { useEffect, useRef, useState } from 'react';

import { recoveryPath, type RecoveryListItem } from '../../../shared/fence';
import { colors, motion } from '../../theme/tokens.stylex';
import { ownClientIds } from '../blame/registry';
import { jotEditorExtension, TitleExtension } from '../extensions';
import { ago } from '../format';
import { uploadedHashes } from '../handoff';
import { MenuItem, popoverProps } from '../menu';
import { infoStyles } from '../NoteInfo';
import type { NoteSession } from '../session';
import { useSignal } from '../useSignal';

/**
 * Offline edits the note could not take (D34): edits made against an
 * earlier generation of the note (a tab open while it was created again, a
 * copy from an earlier jot) wait in the note's quarantine. This view lists
 * them, reads one with jot's node set (a chunk of its own), shows it read only
 * beside the live note, copies its text and exports it losslessly. The
 * person copies what they want back in.
 */

interface RecoveryState {
  records: ReadonlySignal<RecoveryListItem[] | null>;
  refresh(): void;
}

const states = new WeakMap<NoteSession, RecoveryState>();

/** The note's offline edits, fetched once per session (a handoff opens a new session). */
export function recoveryState(session: NoteSession): RecoveryState {
  let state = states.get(session);
  if (state === undefined) {
    const records = signal<RecoveryListItem[] | null>(null);
    const refresh = () => {
      fetch(recoveryPath(session.noteId))
        .then((response) => (response.ok ? response.json() : { records: [] }))
        .then((body: { records?: RecoveryListItem[] }) => {
          records.value = body.records ?? [];
        })
        .catch(() => {
          records.value = [];
        });
    };
    state = { records, refresh };
    states.set(session, state);
    refresh();
  }
  return state;
}

/** The records worth a look: they hold something the note lacks. */
export function actionableRecords(records: readonly RecoveryListItem[]): RecoveryListItem[] {
  return records.filter((record) => record.actionable);
}

/** Whether this browser made a record: one of its client ids wrote it, or this tab uploaded it. */
export function isYours(
  record: RecoveryListItem,
  clients: ReadonlySet<number>,
  uploads: ReadonlySet<string>,
): boolean {
  return (
    (record.upload !== null && uploads.has(record.upload)) ||
    record.clients.some((client) => clients.has(client))
  );
}

function conflictCount(n: number): string {
  return n === 1 ? 'one change' : `${n} changes`;
}

const SEEN_PREFIX = 'jot:recovery-seen:';

function seenRecords(id: string): Set<number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${SEEN_PREFIX}${id}`) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(Number.isSafeInteger) : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: string, seqs: readonly number[]): void {
  try {
    const seen = seenRecords(id);
    for (const seq of seqs) {
      seen.add(seq);
    }
    localStorage.setItem(`${SEEN_PREFIX}${id}`, JSON.stringify([...seen].slice(-200)));
  } catch {
    // Storage denied: the banner comes back on the next page.
  }
}

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

const styles = stylex.create({
  banner: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: '20px',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: '8px',
    backgroundColor: `color-mix(in srgb, ${colors['--accent']} 9%, ${colors['--bg']})`,
    color: colors['--ink'],
    fontSize: '13.5px',
    lineHeight: 1.5,
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  text: {
    margin: 0,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '8px',
  },
  button: {
    paddingBlock: '5px',
    paddingInline: '9px',
    borderRadius: '8px',
    backgroundColor: { default: colors['--hover'], ':hover': colors['--rule'] },
    color: colors['--ink'],
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  preview: {
    marginTop: '10px',
    maxHeight: '320px',
    overflowY: 'auto',
    paddingBlock: '10px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: '8px',
    backgroundColor: colors['--bg'],
    fontSize: '15px',
  },
  muted: {
    marginTop: '8px',
    marginBottom: 0,
    color: colors['--muted'],
    fontSize: '12.5px',
  },
  list: {
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  row: {
    paddingBlock: '8px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--rule'],
  },
  rowHead: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
  },
});

/** Above the note: this browser's offline edits that the note could not take. */
export function RecoveryBanner({ session }: { session: NoteSession }) {
  const records = useSignal(recoveryState(session).records);
  const [dismissed, setDismissed] = useState(() => seenRecords(session.noteId));
  const [open, setOpen] = useState(false);
  if (records === null) {
    return null;
  }
  const clients = ownClientIds();
  const uploads = uploadedHashes(session.noteId);
  const yours = actionableRecords(records).filter(
    (record) => isYours(record, clients, uploads) && !dismissed.has(record.seq),
  );
  const newest = yours[yours.length - 1];
  if (newest === undefined) {
    return null;
  }
  const dismiss = () => {
    markSeen(
      session.noteId,
      yours.map((record) => record.seq),
    );
    setDismissed(seenRecords(session.noteId));
  };
  return (
    <div
      {...stylex.props(styles.banner)}
      role="note"
      data-testid="recovery-banner"
      data-own-press=""
    >
      <p {...stylex.props(styles.text)}>
        {newest.replay !== null && newest.replay.applied > 0
          ? `Your offline edits from ${ago(newest.receivedAt / 1000)} went into this note, except ${conflictCount(newest.replay.conflicts)} to something that changed here meanwhile. All of them are saved here: copy what you want back in.`
          : `Edits you made offline ${ago(newest.receivedAt / 1000)} could not go into this note, because it changed meanwhile. They are saved here: copy what you want back in.`}
      </p>
      <div {...stylex.props(styles.actions)}>
        <button type="button" {...stylex.props(styles.button)} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'View'}
        </button>
        <button type="button" {...stylex.props(styles.button)} onClick={dismiss}>
          Dismiss
        </button>
      </div>
      {open && <RecoveryPreview session={session} seq={newest.seq} />}
    </div>
  );
}

/** ⋯ → Offline edits, while the note keeps any worth a look. */
export function RecoveryMenuItem({ session, open }: { session: NoteSession; open: () => void }) {
  const records = useSignal(recoveryState(session).records);
  const count = records === null ? 0 : actionableRecords(records).length;
  if (count === 0) {
    return null;
  }
  return (
    <MenuItem
      icon="offline"
      label="Offline edits"
      hint={String(count)}
      onSelect={open}
      testId="recovery-item"
    />
  );
}

/** Every record worth a look, newest first, each viewable and exportable. */
export function RecoveryPanel({
  session,
  viaKeyboard,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
}) {
  const records = useSignal(recoveryState(session).records);
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viaKeyboard) {
      ref.current?.focus();
    }
  }, [viaKeyboard]);
  const clients = ownClientIds();
  const uploads = uploadedHashes(session.noteId);
  const shown = actionableRecords(records ?? []).reverse();
  return (
    <div
      ref={ref}
      {...popoverProps(infoStyles.panel)}
      role="dialog"
      aria-label="Offline edits"
      tabIndex={-1}
      data-testid="recovery-panel"
    >
      <div {...stylex.props(infoStyles.title)}>Offline edits</div>
      <p {...stylex.props(styles.muted)}>
        Edits made against an earlier version of this note. Kept for 90 days.
      </p>
      <ul {...stylex.props(styles.list)}>
        {shown.map((record) => (
          <li key={record.seq} {...stylex.props(styles.row)} data-testid="recovery-row">
            <div {...stylex.props(styles.rowHead)}>
              <span>{isYours(record, clients, uploads) ? 'Yours' : 'Another visitor'}</span>
              <span {...stylex.props(infoStyles.muted)}>{ago(record.receivedAt / 1000)}</span>
            </div>
            <div {...stylex.props(styles.actions)}>
              <button
                type="button"
                {...stylex.props(styles.button)}
                onClick={() => setOpen(open === record.seq ? null : record.seq)}
              >
                {open === record.seq ? 'Hide' : 'View'}
              </button>
              <a
                {...stylex.props(styles.button)}
                href={recoveryPath(session.noteId, `/${record.seq}/raw`)}
                download
              >
                Export
              </a>
            </div>
            {open === record.seq && <RecoveryPreview session={session} seq={record.seq} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Render =
  | { state: 'loading' }
  | { state: 'shown'; editorState: SerializedEditorState }
  | { state: 'unreadable' };

/** One record, read only, as jot's editor shows it, with Copy text and Export. */
export function RecoveryPreview({ session, seq }: { session: NoteSession; seq: number }) {
  const [render, setRender] = useState<Render>({ state: 'loading' });
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditorWithDispose | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(recoveryPath(session.noteId, `/${seq}/view`)).then(async (response) => {
        if (!response.ok) {
          throw new Error(`view: ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      }),
      // Its own chunk: only the recovery view loads it.
      import('./render'),
    ])
      .then(([state, { renderView }]) => {
        if (!cancelled) {
          const rendered = renderView(state);
          setRender(
            rendered.ok
              ? { state: 'shown', editorState: rendered.editorState }
              : { state: 'unreadable' },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRender({ state: 'unreadable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, seq]);

  useEffect(() => {
    if (render.state !== 'shown' || rootRef.current === null) {
      return;
    }
    const editor = buildEditorFromExtensions(
      defineExtension({
        name: 'jot/recovery-preview',
        dependencies: [jotEditorExtension, configExtension(TitleExtension, { disabled: true })],
      }),
    );
    editor.setEditable(false);
    editor.setEditorState(editor.parseEditorState(render.editorState));
    editor.setRootElement(rootRef.current);
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
      editor.setRootElement(null);
      editor.dispose();
    };
  }, [render]);

  const copyText = () => {
    const text = rootRef.current?.innerText ?? '';
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };

  return (
    <div data-testid="recovery-preview">
      {render.state === 'loading' && <p {...stylex.props(styles.muted)}>Loading…</p>}
      {render.state === 'unreadable' && (
        <p {...stylex.props(styles.muted)}>
          This copy can&rsquo;t be shown here. Export keeps all of it.
        </p>
      )}
      {render.state === 'shown' && (
        <div
          ref={rootRef}
          {...stylex.props(styles.preview)}
          aria-label="Offline edits, read only"
          aria-readonly="true"
          role="textbox"
          data-testid="recovery-text"
        />
      )}
      <div {...stylex.props(styles.actions)}>
        {render.state === 'shown' && (
          <button type="button" {...stylex.props(styles.button)} onClick={copyText}>
            {copied ? 'Copied' : 'Copy text'}
          </button>
        )}
        <a
          {...stylex.props(styles.button)}
          href={recoveryPath(session.noteId, `/${seq}/raw`)}
          download
        >
          Export
        </a>
      </div>
    </div>
  );
}
