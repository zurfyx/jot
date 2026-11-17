import { buildEditorFromExtensions } from '@lexical/extension';
import { type ReadonlySignal, signal } from '@lexical/extension';
import type { YOfflineCapture, YOfflineRecovered } from '@lexical/y/offline';
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
 * Offline edits the note could not take: edits made against an earlier
 * generation of the note (a tab open while it was migrated or created again,
 * a copy from an earlier jot). This browser's wait on this device, as
 * captures of the note's offline session (D37); a page from before the
 * fence, or one with no store here, left them in the note's quarantine (D34).
 * This view lists both, reads one with jot's node set (a chunk of its own),
 * shows it read only beside the live note, copies its text and exports it
 * losslessly. The person copies what they want back in.
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

/**
 * This device's captures worth a look: something the note lacks, or a copy
 * the reports could not read (Export still keeps all of it). Newest last.
 */
export function shownCaptures(recovered: readonly YOfflineRecovered[]): YOfflineCapture[] {
  return recovered
    .filter(
      ({ capture, report }) =>
        // Replayed, or written into the note as leftovers: nothing left to show.
        capture.resolved === undefined &&
        (!report.ok || report.value.blocks.length > 0 || report.value.orderDiffers),
    )
    .map(({ capture }) => capture)
    .sort((a, b) => a.capturedAt - b.capturedAt);
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

const SEEN_PREFIX = 'jot:recovery-seen:';

/** What the banner was dismissed for: record seqs, and captures as `c:<id>`. */
function seenRecords(id: string): Set<number | string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`${SEEN_PREFIX}${id}`) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((v) => Number.isSafeInteger(v) || typeof v === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function markSeen(id: string, keys: readonly (number | string)[]): void {
  try {
    const seen = seenRecords(id);
    for (const key of keys) {
      seen.add(key);
    }
    localStorage.setItem(`${SEEN_PREFIX}${id}`, JSON.stringify([...seen].slice(-200)));
  } catch {
    // Storage denied: the banner comes back on the next page.
  }
}

/** One entry the views show: a capture on this device, or a record of the note. */
type Entry =
  | { kind: 'capture'; capture: YOfflineCapture; at: number }
  | { kind: 'record'; record: RecoveryListItem; at: number };

function entryKey(entry: Entry): number | string {
  return entry.kind === 'capture' ? `c:${entry.capture.id}` : entry.record.seq;
}

/** A capture's bytes as a download (lossless, as a record's Export). */
function useCaptureDownload(capture: YOfflineCapture | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (capture === null) {
      return;
    }
    const made = URL.createObjectURL(
      new Blob([capture.state as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [capture]);
  return url;
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
  const recovered = useSignal(session.offline.captures);
  const [dismissed, setDismissed] = useState(() => seenRecords(session.noteId));
  const [open, setOpen] = useState(false);
  if (records === null && recovered === null) {
    return null;
  }
  const clients = ownClientIds();
  const uploads = uploadedHashes(session.noteId);
  const yours: Entry[] = [
    ...shownCaptures(recovered ?? []).map((capture): Entry => ({
      kind: 'capture',
      capture,
      at: capture.capturedAt,
    })),
    ...actionableRecords(records ?? [])
      .filter((record) => isYours(record, clients, uploads))
      .map((record): Entry => ({ kind: 'record', record, at: record.receivedAt })),
  ]
    .filter((entry) => !dismissed.has(entryKey(entry)))
    .sort((a, b) => a.at - b.at);
  const newest = yours[yours.length - 1];
  if (newest === undefined) {
    return null;
  }
  const dismiss = () => {
    markSeen(session.noteId, yours.map(entryKey));
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
        Edits you made offline {ago(newest.at / 1000)} could not go into this note, because it
        changed meanwhile. They are saved {newest.kind === 'capture' ? 'on this device' : 'here'}:
        copy what you want back in.
      </p>
      <div {...stylex.props(styles.actions)}>
        <button type="button" {...stylex.props(styles.button)} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'View'}
        </button>
        <button type="button" {...stylex.props(styles.button)} onClick={dismiss}>
          Dismiss
        </button>
      </div>
      {open && (
        <RecoveryPreview
          session={session}
          source={
            newest.kind === 'capture'
              ? { kind: 'capture', capture: newest.capture }
              : { kind: 'record', seq: newest.record.seq }
          }
        />
      )}
    </div>
  );
}

/** ⋯ → Offline edits, while the note keeps any worth a look. */
export function RecoveryMenuItem({ session, open }: { session: NoteSession; open: () => void }) {
  const records = useSignal(recoveryState(session).records);
  const recovered = useSignal(session.offline.captures);
  const count =
    (records === null ? 0 : actionableRecords(records).length) +
    (recovered === null ? 0 : shownCaptures(recovered).length);
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

/** Every capture and record worth a look, newest first, each viewable and exportable. */
export function RecoveryPanel({
  session,
  viaKeyboard,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
}) {
  const records = useSignal(recoveryState(session).records);
  const recovered = useSignal(session.offline.captures);
  const [open, setOpen] = useState<number | string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viaKeyboard) {
      ref.current?.focus();
    }
  }, [viaKeyboard]);
  const clients = ownClientIds();
  const uploads = uploadedHashes(session.noteId);
  const captures = shownCaptures(recovered ?? []).reverse();
  const shown = actionableRecords(records ?? []).reverse();
  const toggle = (key: number | string) => setOpen(open === key ? null : key);
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
        {captures.map((capture) => (
          <CaptureRow
            key={capture.id}
            session={session}
            capture={capture}
            open={open === `c:${capture.id}`}
            toggle={() => toggle(`c:${capture.id}`)}
          />
        ))}
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
                onClick={() => toggle(record.seq)}
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
            {open === record.seq && (
              <RecoveryPreview session={session} source={{ kind: 'record', seq: record.seq }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A capture on this device: View, Export and Remove (it is this browser's own). */
function CaptureRow({
  session,
  capture,
  open,
  toggle,
}: {
  session: NoteSession;
  capture: YOfflineCapture;
  open: boolean;
  toggle: () => void;
}) {
  const download = useCaptureDownload(capture);
  return (
    <li {...stylex.props(styles.row)} data-testid="recovery-row">
      <div {...stylex.props(styles.rowHead)}>
        <span>On this device</span>
        <span {...stylex.props(infoStyles.muted)}>{ago(capture.capturedAt / 1000)}</span>
      </div>
      <div {...stylex.props(styles.actions)}>
        <button type="button" {...stylex.props(styles.button)} onClick={toggle}>
          {open ? 'Hide' : 'View'}
        </button>
        {download !== null && (
          <a
            {...stylex.props(styles.button)}
            href={download}
            download={`jot-offline-edits-${session.noteId}.yjs`}
          >
            Export
          </a>
        )}
        <button
          type="button"
          {...stylex.props(styles.button)}
          onClick={() => void session.offline.remove(capture.id)}
        >
          Remove
        </button>
      </div>
      {open && <RecoveryPreview session={session} source={{ kind: 'capture', capture }} />}
    </li>
  );
}

/** What a preview shows: a record of the note, or a capture on this device. */
export type PreviewSource =
  { kind: 'record'; seq: number } | { kind: 'capture'; capture: YOfflineCapture };

type Render =
  | { state: 'loading' }
  | { state: 'shown'; editorState: SerializedEditorState }
  | { state: 'unreadable' };

/** One record or capture, read only, as jot's editor shows it, with Copy text and Export. */
export function RecoveryPreview({
  session,
  source,
}: {
  session: NoteSession;
  source: PreviewSource;
}) {
  const [render, setRender] = useState<Render>({ state: 'loading' });
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LexicalEditorWithDispose | null>(null);

  const capture = source.kind === 'capture' ? source.capture : null;
  const seq = source.kind === 'record' ? source.seq : null;
  const download = useCaptureDownload(capture);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      capture !== null
        ? Promise.resolve(capture.state)
        : fetch(recoveryPath(session.noteId, `/${seq}/view`)).then(async (response) => {
            if (!response.ok) {
              throw new Error(`view: ${response.status}`);
            }
            return new Uint8Array(await response.arrayBuffer());
          }),
      // Its own chunk: only the recovery view loads it.
      import('./render'),
    ])
      .then(([state, { renderCapture, renderView }]) => {
        if (!cancelled) {
          const rendered = capture !== null ? renderCapture(capture) : renderView(state);
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
  }, [session, seq, capture]);

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
        {seq !== null && (
          <a
            {...stylex.props(styles.button)}
            href={recoveryPath(session.noteId, `/${seq}/raw`)}
            download
          >
            Export
          </a>
        )}
        {download !== null && (
          <a
            {...stylex.props(styles.button)}
            href={download}
            download={`jot-offline-edits-${session.noteId}.yjs`}
          >
            Export
          </a>
        )}
      </div>
    </div>
  );
}
