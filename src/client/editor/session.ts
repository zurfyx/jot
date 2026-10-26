import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
  signal,
} from '@lexical/extension';
import { type YBinding, type YBindingStatus, YCollabExtension } from '@lexical/y';
import { WebsocketProvider } from '@y/websocket';
import * as Y from '@y/y';
import { configExtension, defineExtension, type LexicalEditorWithDispose } from 'lexical';
import * as decoding from 'lib0/decoding';

import { NOTE_SOCKET_BASE } from '../../shared/ids';
import { type CapState, capState } from '../../shared/limits';
import { MESSAGE_NOTE_STATUS, NOTE_STATUS_REJECTED } from '../../shared/protocol';
import { jotEditorExtension } from './extensions';
import { localUser } from './presence';

export type Connection = 'connecting' | 'connected' | 'offline';

/** One open note: the shared document, its provider and the bound editor. */
export interface NoteSession {
  id: string;
  doc: Y.Doc;
  provider: WebsocketProvider;
  editor: LexicalEditorWithDispose;
  binding: YBinding;
  /** The binding: pending until the first sync, then active or readonly. */
  status: ReadonlySignal<YBindingStatus>;
  connection: ReadonlySignal<Connection>;
  /** True once the first sync finished; stays true across reconnects. */
  everSynced: ReadonlySignal<boolean>;
  synced: ReadonlySignal<boolean>;
  cap: ReadonlySignal<CapState>;
  dispose(): void;
}

function socketBase(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
}

export function createNoteSession(id: string): NoteSession {
  const doc = new Y.Doc();
  // The provider joins `${serverUrl}/${room}`, which is noteSocketPath(id).
  const provider = new WebsocketProvider(`${socketBase()}${NOTE_SOCKET_BASE}`, `${id}/ws`, doc, {
    connect: false,
    // The server is the one source of truth (it enforces the size cap), so
    // tabs sync through it rather than over a BroadcastChannel.
    disableBc: true,
  });

  const editor = buildEditorFromExtensions(
    defineExtension({
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, {
          doc,
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

  const connection = signal<Connection>('connecting');
  const everSynced = signal(false);
  const synced = signal(false);
  const serverBytes = signal(0);
  const localBytes = signal(0);
  const rejected = signal(false);
  const cap = signal<CapState>('ok');
  const updateCap = () => {
    cap.value = rejected.value ? 'full' : capState(Math.max(serverBytes.value, localBytes.value));
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

  // The local estimate covers edits made offline, before the server has seen them.
  let measureTimer: ReturnType<typeof setTimeout> | null = null;
  const onDocUpdate = () => {
    if (measureTimer === null) {
      measureTimer = setTimeout(() => {
        measureTimer = null;
        localBytes.value = Y.encodeStateAsUpdate(doc).byteLength;
        updateCap();
      }, 1000);
    }
  };
  doc.on('update', onDocUpdate);

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
    if (isSynced) {
      everSynced.value = true;
      // A no-op after the first time. The binding's content-hashed seed
      // keeps two clients opening an empty note at once from doubling it.
      collab.binding.initialize();
    }
  };
  provider.on('status', onStatus);
  provider.on('sync', onSync);

  const user = localUser();
  provider.awareness.setLocalStateField('user', user);

  // Reconnect at once when the browser says the network is back.
  const onOnline = () => {
    if (!provider.wsconnected) {
      provider.disconnect();
      provider.connect();
    }
  };
  window.addEventListener('online', onOnline);

  // Connect in a task, so React Strict Mode's mount, unmount, mount opens one
  // socket instead of closing a connecting one.
  const connectTimer = setTimeout(() => provider.connect());

  // A full note, or a layout this version cannot write, is read only.
  const stopReadOnly = cap.subscribe((value) => {
    if (value === 'full' && editor.isEditable()) {
      editor.setEditable(false);
    }
  });

  return {
    id,
    doc,
    provider,
    editor,
    binding: collab.binding,
    status: collab.status,
    connection,
    everSynced,
    synced,
    cap,
    dispose() {
      clearTimeout(connectTimer);
      if (measureTimer !== null) {
        clearTimeout(measureTimer);
      }
      stopReadOnly();
      window.removeEventListener('online', onOnline);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      doc.off('update', onDocUpdate);
      provider.destroy();
      editor.dispose();
      doc.destroy();
    },
  };
}
