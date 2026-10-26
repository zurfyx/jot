import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
  signal,
} from '@lexical/extension';
import { type YBinding, type YBindingStatus, YCollabExtension } from '@lexical/y';
import { Awareness } from '@y/protocols/awareness';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { configExtension, defineExtension, type LexicalEditorWithDispose } from 'lexical';
import * as decoding from 'lib0/decoding';

import { generateNoteId, NOTE_SOCKET_BASE, notePath } from '../../shared/ids';
import { type CapState, capState } from '../../shared/limits';
import {
  MESSAGE_NOTE_STATUS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_1,
} from '../../shared/protocol';
import { DRAFT_STORAGE_KEY } from '../drafts';
import { excludeServerState, type Unconfirmed, unconfirmedDocument } from './confirm';
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  draftStateAddsTo,
  mergedDraftState,
  moveDraft,
  parseDraft,
  pendingStorageKey,
  readDraft,
  readRawDraft,
  removeDraftIfUnchanged,
  restoreDraftState,
  writeDraft,
} from './draft';
import { REGISTRY_ORIGIN } from './blame/registry';
import { jotEditorExtension } from './extensions';
import { localUser } from './presence';

/**
 * `local`: a draft, with no provider (D18). The others describe the socket
 * of a shared note.
 */
export type Connection = 'local' | 'connecting' | 'connected' | 'offline';

/** How long the pill says "Back online · merged" after an offline spell. */
export const MERGED_FLASH_MS = 4000;

export interface ReconnectEvent {
  /** The person had chosen Work offline (rather than losing the network). */
  afterWorkOffline: boolean;
}

/** One open note: the shared document, its editor, and, once shared, its provider. */
export interface NoteSession {
  /** The note's id; null while it is a local draft. */
  noteId: ReadonlySignal<string | null>;
  doc: Y.Doc;
  /** Presence. It exists before the provider does, and the provider adopts it. */
  awareness: Awareness;
  /** Null while the note is a local draft. */
  readonly provider: WebsocketProvider | null;
  editor: LexicalEditorWithDispose;
  binding: YBinding;
  /** The binding: pending until the first sync, then active or readonly. */
  status: ReadonlySignal<YBindingStatus>;
  connection: ReadonlySignal<Connection>;
  /** True once the first sync finished; stays true across reconnects. */
  everSynced: ReadonlySignal<boolean>;
  /** The server's sync step 2 arrived on the current connection. */
  synced: ReadonlySignal<boolean>;
  /**
   * Synced, and the server has confirmed every local update that was
   * waiting when it synced: only then is an offline spell over.
   */
  confirmed: ReadonlySignal<boolean>;
  /**
   * The page holds content the server may not have: a shared draft, a
   * restored pending copy, or edits after the first sync.
   */
  hasLocalContent: ReadonlySignal<boolean>;
  cap: ReadonlySignal<CapState>;
  /** The note's Yjs size: the larger of the server's figure and the local estimate. */
  bytes: ReadonlySignal<number>;
  /** Work offline is on: the provider is disconnected on purpose. */
  workOffline: ReadonlySignal<boolean>;
  setWorkOffline(on: boolean): void;
  /** Local transactions the server has not confirmed since the connection was lost. */
  pendingEdits: ReadonlySignal<number>;
  /** True for a few seconds after an offline spell has synced and been confirmed. */
  merged: ReadonlySignal<boolean>;
  /** Called when an offline spell is over (PR "blame" flashes blame here). */
  onReconnect(listener: (event: ReconnectEvent) => void): () => void;
  /**
   * Shares a draft: picks an id, keeps the draft as the note's pending copy,
   * and connects a provider with this document, so the empty room receives
   * everything. Returns the note's id at once; the pending copy is kept up
   * to date until the relay has confirmed all of it. Returns null, sharing
   * nothing, when the browser can't store the pending copy. On a shared
   * note, returns its id.
   */
  share(): string | null;
  /** The note's link; null for a draft. */
  link(): string | null;
  /** Stops saving this draft (before "New note" replaces it). A pending copy is kept. */
  forgetDraft(): void;
  dispose(): void;
}

function socketBase(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

/** Opens note `id`, or the local draft when `id` is null. */
export function createNoteSession(id: string | null): NoteSession {
  const doc = new Y.Doc();
  const isDraft = id === null;

  // What this page keeps in localStorage, and under which key: the draft, or
  // a shared note's pending copy (one a page closed before the relay
  // confirmed it). Restored before the binding starts, so it reads it at once.
  let storageKey: string | null = isDraft ? DRAFT_STORAGE_KEY : pendingStorageKey(id);
  const stored = readDraft(storageKey);
  const restored = stored !== null && restoreDraftState(doc, stored.state);
  const draftId = stored?.id ?? generateNoteId();
  if (!isDraft && !restored) {
    storageKey = null;
  }

  const editor = buildEditorFromExtensions(
    defineExtension({
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, {
          doc,
          // A draft has nothing to wait for: initialize now (D18).
          synced: isDraft,
          selfCheck: import.meta.env.DEV,
        }),
      ],
      name: 'jot/note',
      onWarn: (warning) => {
        console.warn(warning);
      },
    }),
  );
  const collab = getExtensionDependencyFromEditor(editor, YCollabExtension).output;

  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', localUser());

  const noteId = signal<string | null>(id);
  const connection = signal<Connection>(isDraft ? 'local' : 'connecting');
  const everSynced = signal(false);
  const synced = signal(false);
  const confirmed = signal(false);
  const hasLocalContent = signal(!isDraft && restored);
  const serverBytes = signal(0);
  const localBytes = signal(0);
  const bytes = signal(0);
  const rejected = signal(false);
  const cap = signal<CapState>('ok');
  const workOffline = signal(false);
  const pendingEdits = signal(0);
  const merged = signal(false);
  const reconnectListeners = new Set<(event: ReconnectEvent) => void>();

  const updateCap = () => {
    bytes.value = Math.max(serverBytes.value, localBytes.value);
    cap.value = rejected.value ? 'full' : capState(bytes.value);
  };
  const measure = () => {
    localBytes.value = Y.encodeStateAsUpdate(doc).byteLength;
    updateCap();
  };

  let provider: WebsocketProvider | null = null;
  let offlineSpell: { manual: boolean } | null = null;
  let mergedTimer: ReturnType<typeof setTimeout> | null = null;
  const stopProvider: (() => void)[] = [];

  // Local persistence: a debounce after the last change, and on pagehide.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (storageKey !== null) {
      // Merged with what is stored, so newer edits another page saved under
      // the same draft are never overwritten.
      const state = mergedDraftState(doc, readDraft(storageKey), draftId);
      writeDraft(storageKey, { id: draftId, state });
    }
  };
  const stopSaving = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    storageKey = null;
  };

  /**
   * Called when the server has confirmed everything this page holds. The
   * pending copy is dropped only if it adds nothing to this document (so
   * nothing in it is unconfirmed). If it is newer (another page saved later
   * edits to it), they are applied and sent instead, and this runs again
   * once they are confirmed. Returns whether the copy is gone.
   */
  const dropPendingCopy = (): boolean => {
    if (storageKey === null) {
      return true;
    }
    const raw = readRawDraft(storageKey);
    const stored = parseDraft(raw);
    if (raw === null || stored === null || stored.id !== draftId) {
      // Gone already, or not this draft's: leave it be.
      stopSaving();
      return true;
    }
    if (draftStateAddsTo(doc, stored.state)) {
      restoreDraftState(doc, stored.state);
      return false;
    }
    removeDraftIfUnchanged(storageKey, raw);
    stopSaving();
    return true;
  };

  let measureTimer: ReturnType<typeof setTimeout> | null = null;
  const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (measureTimer === null) {
      measureTimer = setTimeout(() => {
        measureTimer = null;
        measure();
      }, 1000);
    }
    if (storageKey !== null) {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
      }
      saveTimer = setTimeout(save, DRAFT_SAVE_DEBOUNCE_MS);
    }
    if (noteId.peek() !== null && origin !== provider && origin !== 'draft') {
      // Edits after the first sync, or on a shared draft, are local content
      // until the server confirms them.
      if (everSynced.peek() || hasLocalContent.peek()) {
        hasLocalContent.value = true;
        // The people registry's own writes (blame) are not edits.
        if (!confirmed.peek() && origin !== REGISTRY_ORIGIN) {
          pendingEdits.value++;
        }
      }
    }
  };
  doc.on('update', onDocUpdate);
  window.addEventListener('pagehide', save);

  const connect = (noteIdValue: string, localContent: boolean): WebsocketProvider => {
    // The provider joins `${serverUrl}/${room}`, which is noteSocketPath(id).
    const created = new WebsocketProvider(
      `${socketBase()}${NOTE_SOCKET_BASE}`,
      `${noteIdValue}/ws`,
      doc,
      {
        connect: false,
        awareness,
        // The server is the one source of truth (it enforces the size cap), so
        // tabs sync through it rather than over a BroadcastChannel.
        disableBc: true,
      },
    );

    // jot's own message: the stored size, and whether an update was rejected.
    created.messageHandlers[MESSAGE_NOTE_STATUS] = (_encoder, decoder) => {
      serverBytes.value = decoding.readVarUint(decoder);
      const flags = decoding.readVarUint(decoder);
      if ((flags & NOTE_STATUS_REJECTED) !== 0) {
        rejected.value = true;
      }
      updateCap();
    };

    if (localContent) {
      // Content already in the document before the provider existed (a
      // shared draft, a restored pending copy) is unconfirmed too.
      created.unconfirmedUpdates.push(unconfirmedDocument(doc));
    }

    // Entries that must be confirmed before this connection's sync counts.
    let outstanding: Unconfirmed[] | null = null;
    const settle = () => {
      if (!created.synced) {
        return;
      }
      const unconfirmed = created.unconfirmedUpdates;
      if (storageKey !== null && noteId.peek() !== null && unconfirmed.length === 0) {
        // The server has everything this page holds: the pending copy can go,
        // unless it holds more.
        dropPendingCopy();
      }
      if (confirmed.peek()) {
        return;
      }
      if (outstanding !== null && outstanding.some((entry) => unconfirmed.includes(entry))) {
        return;
      }
      outstanding = null;
      confirmed.value = true;
      pendingEdits.value = 0;
      measure();
      if (offlineSpell !== null) {
        const event: ReconnectEvent = { afterWorkOffline: offlineSpell.manual };
        offlineSpell = null;
        merged.value = true;
        if (mergedTimer !== null) {
          clearTimeout(mergedTimer);
        }
        mergedTimer = setTimeout(() => {
          mergedTimer = null;
          merged.value = false;
        }, MERGED_FLASH_MS);
        for (const listener of reconnectListeners) {
          listener(event);
        }
      }
    };

    const handleSync = created.messageHandlers[MESSAGE_SYNC]!;
    created.messageHandlers[MESSAGE_SYNC] = (encoder, decoder, ...rest) => {
      // The server's sync step 1 carries its state vector.
      const peek = decoding.createDecoder(decoder.arr);
      peek.pos = decoder.pos;
      const serverStep1 = decoding.readVarUint(peek) === SYNC_STEP_1;
      const stateVector = serverStep1
        ? Y.decodeStateVector(decoding.readVarUint8Array(peek))
        : null;
      handleSync(encoder, decoder, ...rest);
      if (stateVector !== null) {
        created.unconfirmedUpdates = excludeServerState(created.unconfirmedUpdates, stateVector);
      }
      settle();
    };

    const onStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (status === 'connected') {
        connection.value = 'connected';
      } else if (status === 'disconnected' || everSynced.value) {
        connection.value = 'offline';
      } else {
        connection.value = 'connecting';
      }
    };
    const onSync = (isSynced: boolean) => {
      synced.value = isSynced;
      if (!isSynced) {
        confirmed.value = false;
        outstanding = null;
        if (everSynced.peek() && offlineSpell === null) {
          offlineSpell = { manual: workOffline.peek() };
        }
        return;
      }
      // A no-op after the first time, and for a shared draft. The binding's
      // content-hashed seed keeps two clients opening an empty note at once
      // from doubling it. Before everSynced, so the seed is not an edit.
      collab.binding.initialize();
      everSynced.value = true;
      outstanding = [...created.unconfirmedUpdates];
      settle();
    };
    created.on('status', onStatus);
    created.on('sync', onSync);
    stopProvider.push(() => {
      created.off('status', onStatus);
      created.off('sync', onSync);
      created.destroy();
    });
    return created;
  };

  // Reconnect at once when the browser says the network is back, unless the
  // person chose to work offline.
  const onOnline = () => {
    if (provider !== null && !provider.wsconnected && !workOffline.peek()) {
      provider.disconnect();
      provider.connect();
    }
  };
  window.addEventListener('online', onOnline);

  // Connect in a task, so React Strict Mode's mount, unmount, mount opens one
  // socket instead of closing a connecting one.
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  if (id !== null) {
    provider = connect(id, restored);
    const opening = provider;
    connectTimer = setTimeout(() => opening.connect());
  } else {
    measure();
  }

  // A full note is read only. The binding sets the editor's editable state
  // whenever it re-reads its status, so hold it read only from a listener.
  const holdReadOnly = () => {
    if (cap.peek() === 'full' && editor.isEditable()) {
      editor.setEditable(false);
    }
  };
  const stopCap = cap.subscribe(holdReadOnly);
  const stopEditable = editor.registerEditableListener(holdReadOnly);

  const link = () => {
    const current = noteId.peek();
    return current === null ? null : `${window.location.origin}${notePath(current)}`;
  };

  return {
    noteId,
    doc,
    awareness,
    get provider() {
      return provider;
    },
    editor,
    binding: collab.binding,
    status: collab.status,
    connection,
    everSynced,
    synced,
    confirmed,
    hasLocalContent,
    cap,
    bytes,
    workOffline,
    setWorkOffline(on) {
      if (provider === null || workOffline.peek() === on) {
        return;
      }
      workOffline.value = on;
      if (on) {
        // The note stays editable; edits wait in the document.
        provider.disconnect();
      } else {
        provider.connect();
      }
    },
    pendingEdits,
    merged,
    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    },
    share() {
      const current = noteId.peek();
      if (current !== null) {
        return current;
      }
      const shared = generateNoteId();
      // The draft becomes the note's pending copy first, then leaves the
      // draft slot (only if that slot still holds this draft: another tab
      // may have stored its own). It stays saved until the relay confirms.
      // If the browser can't store the copy, nothing is shared: the draft
      // stays as it was, and Share can be tried again.
      const pendingKey = pendingStorageKey(shared);
      const state = mergedDraftState(doc, readDraft(DRAFT_STORAGE_KEY), draftId);
      if (!moveDraft(DRAFT_STORAGE_KEY, pendingKey, { id: draftId, state })) {
        return null;
      }
      storageKey = pendingKey;
      noteId.value = shared;
      hasLocalContent.value = true;
      connection.value = 'connecting';
      provider = connect(shared, true);
      provider.connect();
      return shared;
    },
    link,
    forgetDraft() {
      if (noteId.peek() === null) {
        stopSaving();
      }
    },
    dispose() {
      if (connectTimer !== null) {
        clearTimeout(connectTimer);
      }
      if (measureTimer !== null) {
        clearTimeout(measureTimer);
      }
      if (mergedTimer !== null) {
        clearTimeout(mergedTimer);
      }
      // A draft, or a pending copy the relay has not confirmed yet.
      save();
      reconnectListeners.clear();
      stopCap();
      stopEditable();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', save);
      doc.off('update', onDocUpdate);
      for (const stop of stopProvider.splice(0)) {
        stop();
      }
      awareness.destroy();
      editor.dispose();
      doc.destroy();
    },
  };
}
