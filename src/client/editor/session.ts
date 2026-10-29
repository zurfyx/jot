import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
  signal,
} from '@lexical/extension';
import { createYDoc, type YBinding, type YBindingStatus, YCollabExtension } from '@lexical/y';
import { Awareness } from '@y/protocols/awareness';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { configExtension, defineExtension, type LexicalEditorWithDispose } from 'lexical';
import * as decoding from 'lib0/decoding';

import { NOTE_SOCKET_BASE, notePath } from '../../shared/ids';
import { type CapState, capState } from '../../shared/limits';
import { SCHEMA_VERSION } from '../../shared/schema';
import {
  MESSAGE_NOTE_STATUS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_1,
} from '../../shared/protocol';
import { excludeServerState, type Unconfirmed } from './confirm';
import { REGISTRY_ORIGIN } from './blame/registry';
import { jotEditorExtension } from './extensions';
import { localUser } from './presence';
import { compactedSize } from './size';

/** The note's socket. */
export type Connection = 'connecting' | 'connected' | 'offline';

/** How long the pill says "Back online · merged" after an offline spell. */
export const MERGED_FLASH_MS = 4000;

export interface ReconnectEvent {
  /** The person had chosen Work offline (rather than losing the network). */
  afterWorkOffline: boolean;
}

/** One open note: the shared document, its editor and its provider. Every note is shared (D23). */
export interface NoteSession {
  noteId: string;
  doc: Y.Doc;
  /** Presence. It exists before the provider does, and the provider adopts it. */
  awareness: Awareness;
  provider: WebsocketProvider;
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
  /** The note's link. */
  link(): string;
  dispose(): void;
}

function socketBase(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

/** Opens note `id`: its document, editor and provider. */
export function createNoteSession(id: string): NoteSession {
  const doc = createYDoc();

  const editor = buildEditorFromExtensions(
    defineExtension({
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, {
          doc,
          schemaVersion: SCHEMA_VERSION,
          // Initialized on the first sync (onSync below).
          synced: false,
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

  const connection = signal<Connection>('connecting');
  const everSynced = signal(false);
  const synced = signal(false);
  const confirmed = signal(false);
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
    localBytes.value = compactedSize(doc);
    updateCap();
  };

  let offlineSpell: { manual: boolean } | null = null;
  let mergedTimer: ReturnType<typeof setTimeout> | null = null;

  let measureTimer: ReturnType<typeof setTimeout> | null = null;
  // Local edits made while connected that the relay has not echoed yet. A link
  // that dies silently is only noticed later, so these wait too once it drops.
  let inFlight = 0;
  const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
    if (measureTimer === null) {
      measureTimer = setTimeout(() => {
        measureTimer = null;
        measure();
      }, 1000);
    }
    // Edits after the first sync wait for the server's confirmation; the
    // people registry's own writes (blame) are not edits.
    if (origin !== provider && everSynced.peek() && origin !== REGISTRY_ORIGIN) {
      if (confirmed.peek()) {
        inFlight++;
      } else {
        pendingEdits.value++;
      }
    }
  };
  // The provider joins `${serverUrl}/${room}`, which is noteSocketPath(id).
  const provider = new WebsocketProvider(`${socketBase()}${NOTE_SOCKET_BASE}`, `${id}/ws`, doc, {
    connect: false,
    awareness,
    // The server is the one source of truth (it enforces the size cap), so
    // tabs sync through it rather than over a BroadcastChannel.
    disableBc: true,
  });

  // jot's own message: the stored size, and whether an update was rejected.
  provider.messageHandlers[MESSAGE_NOTE_STATUS] = (_encoder, decoder) => {
    serverBytes.value = decoding.readVarUint(decoder);
    const flags = decoding.readVarUint(decoder);
    if ((flags & NOTE_STATUS_REJECTED) !== 0) {
      rejected.value = true;
    }
    updateCap();
  };

  // Entries that must be confirmed before this connection's sync counts.
  let outstanding: Unconfirmed[] | null = null;
  const settle = () => {
    if (!provider.synced) {
      return;
    }
    const unconfirmed = provider.unconfirmedUpdates;
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

  const handleSync = provider.messageHandlers[MESSAGE_SYNC]!;
  provider.messageHandlers[MESSAGE_SYNC] = (encoder, decoder, ...rest) => {
    // The server's sync step 1 carries its state vector.
    const peek = decoding.createDecoder(decoder.arr);
    peek.pos = decoder.pos;
    const serverStep1 = decoding.readVarUint(peek) === SYNC_STEP_1;
    const stateVector = serverStep1 ? Y.decodeStateVector(decoding.readVarUint8Array(peek)) : null;
    handleSync(encoder, decoder, ...rest);
    if (stateVector !== null) {
      provider.unconfirmedUpdates = excludeServerState(provider.unconfirmedUpdates, stateVector);
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
      if (confirmed.peek() && provider.unconfirmedUpdates.length > 0) {
        pendingEdits.value += inFlight;
      }
      inFlight = 0;
      confirmed.value = false;
      outstanding = null;
      if (everSynced.peek() && offlineSpell === null) {
        offlineSpell = { manual: workOffline.peek() };
      }
      return;
    }
    // A no-op after the first time. The binding's content-hashed seed keeps
    // two clients opening an empty note at once from doubling it. Before
    // everSynced, so the seed is not an edit.
    collab.binding.initialize();
    everSynced.value = true;
    outstanding = [...provider.unconfirmedUpdates];
    settle();
  };
  const onSyncStatus = () => {
    if (provider.unconfirmedUpdates.length === 0) {
      inFlight = 0;
    }
  };
  provider.on('status', onStatus);
  provider.on('sync', onSync);
  provider.on('sync-status', onSyncStatus);
  doc.on('update', onDocUpdate);

  // Reconnect at once when the browser says the network is back, unless the
  // person chose to work offline.
  const onOnline = () => {
    if (!provider.wsconnected && !workOffline.peek()) {
      provider.disconnect();
      provider.connect();
    }
  };
  window.addEventListener('online', onOnline);

  // Connect in a task, so React Strict Mode's mount, unmount, mount opens one
  // socket instead of closing a connecting one.
  const connectTimer = setTimeout(() => provider.connect());

  // A full note is read only. The binding sets the editor's editable state
  // whenever it re-reads its status, so hold it read only from a listener.
  const holdReadOnly = () => {
    if (cap.peek() === 'full' && editor.isEditable()) {
      editor.setEditable(false);
    }
  };
  const stopCap = cap.subscribe(holdReadOnly);
  const stopEditable = editor.registerEditableListener(holdReadOnly);

  return {
    noteId: id,
    doc,
    awareness,
    provider,
    editor,
    binding: collab.binding,
    status: collab.status,
    connection,
    everSynced,
    synced,
    confirmed,
    cap,
    bytes,
    workOffline,
    setWorkOffline(on) {
      if (workOffline.peek() === on) {
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
    link() {
      return `${window.location.origin}${notePath(id)}`;
    },
    dispose() {
      clearTimeout(connectTimer);
      if (measureTimer !== null) {
        clearTimeout(measureTimer);
      }
      if (mergedTimer !== null) {
        clearTimeout(mergedTimer);
      }
      reconnectListeners.clear();
      stopCap();
      stopEditable();
      window.removeEventListener('online', onOnline);
      doc.off('update', onDocUpdate);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.off('sync-status', onSyncStatus);
      provider.destroy();
      awareness.destroy();
      editor.dispose();
      doc.destroy();
    },
  };
}
