import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
  signal,
} from '@lexical/extension';
import {
  createYCollabConfig,
  createYDoc,
  createYServerLayoutUpgrade,
  type YBinding,
  type YBindingStatus,
  YCollabExtension,
} from '@lexical/y';
import {
  attachYOfflineSession,
  recoverYOfflineEdits,
  type YOfflineRecovered,
  type YOfflineSession,
  type YOfflineStage,
} from '@lexical/y/offline';
import { Awareness } from '@y/protocols/awareness';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { defineExtension, type LexicalEditorWithDispose } from 'lexical';
import * as decoding from 'lib0/decoding';

import { type Handshake, handshakeParams } from '../../shared/fence';
import { NOTE_SOCKET_BASE, notePath } from '../../shared/ids';
import { type CapState, capState } from '../../shared/limits';
import { SCHEMA_VERSION } from '../../shared/schema';
import {
  FENCE_REFUSE_LAYOUT,
  FENCE_STALE,
  MESSAGE_NOTE_FENCE,
  MESSAGE_NOTE_STATUS,
  MESSAGE_SYNC,
  NOTE_STATUS_REJECTED,
  SYNC_STEP_1,
} from '../../shared/protocol';
import { excludeServerState, type Unconfirmed } from './confirm';
import { REGISTRY_ORIGIN } from './blame/registry';
import { jotEditorExtension } from './extensions';
import { localUser } from './presence';
import { handOff, handOffCapture, type HandoffResult } from './handoff';
import {
  OFFLINE_CONFIG,
  OFFLINE_STAGE,
  OFFLINE_WRITE_DELAY_MS,
  holdsNothingNew,
  type PreparedNote,
  pruneCaptures,
} from './offline';
import { compactedSize } from './size';

/** The note's socket. */
export type Connection = 'connecting' | 'connected' | 'offline';

/** How long the pill says "Back online · merged" after an offline spell. */
export const MERGED_FLASH_MS = 4000;

/**
 * The generation fence (D34), as the page sees it: `ok`; `handing-off` (the
 * note moved on while this page held edits made against an earlier one: they
 * are being saved, on this device (D37) or, without a store here, to the
 * note's offline edits); `saved` (they are; the page opens the note afresh);
 * `reload` (this release cannot open the note); `failed` (the edits could not
 * be saved: the page keeps them read only).
 */
export type Fence = 'ok' | 'handing-off' | 'saved' | 'reload' | 'failed';

/** Unsent edits on this device (D37): the note's offline session and what it captured. */
export interface NoteOffline {
  /** `off` when this browser has no store (edits then live in the page, as before). */
  stage: YOfflineStage;
  /** Why edits are not being saved on this device, while a write keeps failing. */
  problem: ReadonlySignal<string | null>;
  /** This device's captures of the note, with their reports; null until the first sync. */
  captures: ReadonlySignal<YOfflineRecovered[] | null>;
  /** Gathers the captures again (after one is removed, or another tab's arrives). */
  refresh(): Promise<void>;
  /** Removes a capture from this device. */
  remove(captureId: string): Promise<void>;
}

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
  /** The generation fence's state for this page (D34). */
  fence: ReadonlySignal<Fence>;
  /** The note's generation this page's document belongs to, once synced. */
  generation(): string | null;
  /** Called before a handoff stops this page's writers: in-tab peers stop here. */
  onBeforeHandoff(listener: () => void): () => void;
  /** Called once a handoff is acknowledged: the page replaces this session with a fresh one. */
  onReplace(listener: () => void): () => void;
  /** Unsent edits on this device (D37). */
  offline: NoteOffline;
  /** The note's link. */
  link(): string;
  dispose(): void;
}

/** Builds this release's session handshake (`@lexical/y`'s layout upgrade handle). */
const LAYOUT_HANDLE = createYServerLayoutUpgrade();

function socketBase(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

const NOTHING_PREPARED: PreparedNote = { store: null, problem: null, loaded: null };

/**
 * Opens note `id`: its document, editor and provider. `prepared` is what this
 * device holds for it (offline.ts's `prepareNote`): a document with edits the
 * server had not taken starts from them, at the generation they were made
 * against, and the note's verdict decides whether they sync (D37).
 */
export function createNoteSession(
  id: string,
  prepared: PreparedNote = NOTHING_PREPARED,
): NoteSession {
  const stored =
    prepared.loaded !== null && prepared.loaded.state !== null ? prepared.loaded : null;
  const doc = createYDoc(stored?.state ?? null);

  const editor = buildEditorFromExtensions(
    defineExtension({
      dependencies: [
        jotEditorExtension,
        createYCollabConfig({
          doc,
          schemaVersion: SCHEMA_VERSION,
          // The note's object migrates a note below MIN_LAYOUT on its first
          // open (D34), before it serves it.
          layoutUpgrade: LAYOUT_HANDLE,
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

  // Unsent edits on this device (D37): only what the server has not taken.
  const offlineStage: YOfflineStage = prepared.store === null ? 'off' : OFFLINE_STAGE;
  const offlineProblem = signal<string | null>(null);
  const offlineCaptures = signal<YOfflineRecovered[] | null>(null);
  const offline: YOfflineSession = attachYOfflineSession({
    binding: collab.collab,
    store: prepared.store,
    key: id,
    epoch: stored?.epoch ?? null,
    loaded: stored ?? undefined,
    stage: offlineStage,
    keep: 'unsynced',
    writeDelay: OFFLINE_WRITE_DELAY_MS,
    onError: (error) => {
      offlineProblem.value = error.message;
    },
  });
  // A write that succeeds again clears the problem.
  const onAfterTransaction = () => {
    if (offlineProblem.peek() !== null) {
      void offline.flush().then((result) => {
        if (result.ok && offline.persisted) {
          offlineProblem.value = null;
        }
      });
    }
  };
  if (prepared.store !== null) {
    doc.on('afterTransaction', onAfterTransaction);
  }
  const onPageHide = () => {
    void offline.flush();
  };
  window.addEventListener('pagehide', onPageHide);

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
  const fence = signal<Fence>('ok');
  const reconnectListeners = new Set<(event: ReconnectEvent) => void>();
  const beforeHandoffListeners = new Set<() => void>();
  const replaceListeners = new Set<() => void>();

  // The fence's record for this page's document (D34): the generation its
  // content belongs to (adopted only when a sync with the note completes),
  // whether it holds anything of its own (local writes), and every client id
  // that wrote into it locally (the editor's, a peer's in this tab).
  let generation: string | null = stored?.epoch ?? null;
  let offered: string | null = null;
  // A stored document holds this device's edits (a never-synced one holds
  // nothing else).
  let localWrites = stored !== null && (stored.hasUnsyncedEdits || stored.epoch === null);
  const ownClients = new Set<number>();
  // `@lexical/y` builds the handshake (version 1: this release's layouts,
  // seed layout and features); never by hand.
  const handshake = (): Handshake =>
    LAYOUT_HANDLE.handshake({ generation, material: localWrites || generation !== null });

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
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== provider) {
      if (!localWrites) {
        localWrites = true;
        provider.params = handshakeParams(handshake());
      }
      try {
        for (const struct of Y.decodeUpdate(update).structs) {
          ownClients.add(struct.id.client);
        }
      } catch {
        ownClients.add(doc.clientID);
      }
    }
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
    // tabs sync through it rather than over a BroadcastChannel. Nothing but
    // the server ever delivers updates to this document (D34: `peers: false`).
    disableBc: true,
    // The fence's handshake (D34), re-read on every reconnect.
    params: handshakeParams(handshake()),
  });

  // The fence's verdict, first on every connection (D34).
  provider.messageHandlers[MESSAGE_NOTE_FENCE] = (_encoder, decoder) => {
    const verdict = decoding.readVarUint(decoder);
    const roomGeneration = decoding.readVarString(decoder);
    decoding.readVarUint(decoder);
    if (verdict === FENCE_STALE) {
      offered = null;
      startHandoff(roomGeneration);
    } else if (verdict === FENCE_REFUSE_LAYOUT) {
      offered = null;
      provider.disconnect();
      fence.value = 'reload';
      reloadOnce(id);
    } else {
      offered = roomGeneration;
      // The note's generation is the offline session's epoch (D37): a
      // document that never synced adopts it. Admitted, the document is of
      // this generation, so the session agrees; should it not, its edits
      // are captured and the page opens the note afresh, as for stale.
      void offline.serverEpoch(roomGeneration).then((result) => {
        if (result.kind === 'moved') {
          startHandoff(roomGeneration);
        }
      });
    }
  };

  let handoff: Promise<HandoffResult> | null = null;
  const startHandoff = (roomGeneration: string) => {
    provider.disconnect();
    if (handoff !== null) {
      return;
    }
    fence.value = 'handing-off';
    for (const listener of beforeHandoffListeners) {
      try {
        listener();
      } catch (error) {
        console.error('jot: a writer did not stop for the handoff', error);
      }
    }
    handoff = (async (): Promise<HandoffResult> => {
      // On this device first (D37): the session freezes the binding and
      // keeps what it holds as a capture, which the fresh session lists.
      const result = await offline.serverEpoch(roomGeneration, { reason: 'stale' });
      if (result.kind === 'moved') {
        if (result.saved.ok || result.capture === null) {
          return 'saved';
        }
        // The store could not take it (full, closed): to the note's offline
        // edits instead, as one record (D34).
        return handOffCapture({
          noteId: id,
          capture: result.capture,
          generation,
          clients: [...ownClients],
        });
      }
      // No store here (stage off): the record upload (D34).
      return handOff({
        noteId: id,
        binding: collab.binding,
        generation,
        clients: [...ownClients],
      });
    })();
    void handoff.then((result) => {
      if (result === 'saved') {
        fence.value = 'saved';
        for (const listener of replaceListeners) {
          listener();
        }
      } else {
        fence.value = 'failed';
      }
    });
  };

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
    // The note's generation is this document's once a full sync with it
    // completed (D34): the next connection presents it.
    if (offered !== null && generation === null) {
      generation = offered;
      provider.params = handshakeParams(handshake());
    }
    // A no-op after the first time. The binding's content-hashed seed keeps
    // two clients opening an empty note at once from doubling it. Before
    // everSynced, so the seed is not an edit. The server allows it only in a
    // note this release may seed (D34).
    collab.binding.initialize();
    everSynced.value = true;
    outstanding = [...provider.unconfirmedUpdates];
    settle();
  };
  // The server holds everything this document holds once every local update
  // came back (D37): what is stored on this device goes (keep: unsynced).
  const confirmToStore = () => {
    if (
      !offline.ended &&
      provider.synced &&
      confirmed.peek() &&
      provider.unconfirmedUpdates.length === 0
    ) {
      offline.markSynced();
    }
  };
  let recovered = false;
  const refreshCaptures = async () => {
    if (offline.ended || generation === null || prepared.store === null) {
      offlineCaptures.value = [];
      return;
    }
    const active = collab.status.peek() === 'active';
    try {
      await pruneCaptures(prepared.store, id);
      const result = await recoverYOfflineEdits({
        binding: collab.collab,
        store: prepared.store,
        key: id,
        epoch: generation,
        // Replay writes into the note: only into an editable one.
        stage: active ? offlineStage : 'persist',
        config: OFFLINE_CONFIG,
        session: offline,
      });
      if (result.ok) {
        // A capture the note already holds all of goes (once the server has
        // everything this page holds, so nothing rests on it).
        const kept: YOfflineRecovered[] = [];
        for (const entry of result.value) {
          if (holdsNothingNew(entry.capture.state, doc)) {
            if (!offline.hasUnsyncedEdits) {
              await prepared.store.deleteCapture(id, entry.capture.id);
            }
          } else {
            kept.push(entry);
          }
        }
        offlineCaptures.value = kept;
      } else {
        offlineProblem.value = result.error.message;
        offlineCaptures.value = [];
      }
    } catch (error) {
      console.error('jot: offline edits could not be read', error);
      offlineCaptures.value = [];
    }
  };
  const stopConfirmed = confirmed.subscribe((value) => {
    if (value) {
      confirmToStore();
      if (!recovered) {
        recovered = true;
        void refreshCaptures();
      }
    }
  });
  const onSyncStatus = () => {
    if (provider.unconfirmedUpdates.length === 0) {
      inFlight = 0;
    }
    confirmToStore();
  };
  // The handshake is re-read for the next connection (the URL is built when
  // a socket opens): after a close, before the provider reconnects.
  const refreshHandshake = () => {
    provider.params = handshakeParams(handshake());
  };
  provider.on('connection-close', refreshHandshake);
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
        refreshHandshake();
        provider.connect();
      }
    },
    pendingEdits,
    merged,
    fence,
    offline: {
      stage: offlineStage,
      problem: offlineProblem,
      captures: offlineCaptures,
      refresh: refreshCaptures,
      async remove(captureId) {
        if (prepared.store !== null) {
          await prepared.store.deleteCapture(id, captureId);
        }
        await refreshCaptures();
      },
    },
    generation: () => generation,
    onBeforeHandoff(listener) {
      beforeHandoffListeners.add(listener);
      return () => beforeHandoffListeners.delete(listener);
    },
    onReplace(listener) {
      replaceListeners.add(listener);
      return () => replaceListeners.delete(listener);
    },
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
      beforeHandoffListeners.clear();
      replaceListeners.clear();
      stopCap();
      stopEditable();
      stopConfirmed();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onPageHide);
      doc.off('afterTransaction', onAfterTransaction);
      // What is stored stays; the session lets go of its slot.
      void offline.flush().finally(() => offline.dispose());
      doc.off('update', onDocUpdate);
      provider.off('connection-close', refreshHandshake);
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

/** How soon a second refused connection may reload the page again. */
const RELOAD_GUARD_MS = 60_000;

/**
 * This release cannot open the note (D34): reload once, so the page loads the
 * release that can; a second refusal within a minute leaves the banner up.
 */
function reloadOnce(id: string): void {
  try {
    const key = `jot:fence-reload:${id}`;
    const last = Number(sessionStorage.getItem(key) ?? '0');
    if (Date.now() - last < RELOAD_GUARD_MS) {
      return;
    }
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
}
