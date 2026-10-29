/**
 * In-tab peers (D20): a collaborator that runs inside this tab as a real Yjs
 * client. Each has its own `Y.Doc` (so its own client id), a headless Lexical
 * editor (no root element) bound to that doc with `YCollabExtension`, an entry
 * in the people registry, and its own `Awareness`, relayed into the note's so
 * its caret shows to everyone on the note.
 *
 * The example note's demo collaborators use it, and so does jot AI: whatever a
 * peer writes reaches the note's document, and from there the relay, the same
 * way a person's edits in another window do.
 *
 * A live peer is not free: it mirrors every change to the note, the person's
 * keystrokes included, into its own document and reconciles its own editor.
 * Keep a peer only while it has work to do or presence to show, and dispose
 * it when it goes idle for good.
 */
import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
} from '@lexical/extension';
import { createYDoc, type YBinding, YCollabExtension } from '@lexical/y';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from '@y/protocols/awareness';
import * as Y from '@y/y';
import { configExtension, defineExtension, type LexicalEditorWithDispose } from 'lexical';

import { SCHEMA_VERSION } from '../../../shared/schema';
import { type PersonKind, REGISTRY_ORIGIN, SEEN_REFRESH_MS, writeEntry } from '../blame/registry';
import { jotEditorExtension } from '../extensions';

/** Who a peer is: its registry entry and its presence. */
export interface PeerPerson {
  /** A stable person id: blame groups every client id of a person under it. */
  personId: string;
  /** Shown on its caret, in Note info and in blame. */
  name: string;
  /** An index into the `--peer-*` tokens. */
  color: number;
  kind: Exclude<PersonKind, 'person'>;
  /** For AI: the person id of who asked. */
  askedBy?: string;
}

/** What a peer joins: the note's document and presence. */
export interface PeerHost {
  doc: Y.Doc;
  awareness: Awareness;
  /**
   * The note's connection. When it comes back, the peer announces itself
   * again: the provider drops remote presence while disconnected, and only
   * sends its own state on connect.
   */
  connection?: ReadonlySignal<string>;
  /**
   * The note's binding status and cap state. When given, a peer writes only
   * while the status is `active` and the cap is not `full` (a NoteSession
   * passes both).
   */
  status?: ReadonlySignal<string>;
  cap?: ReadonlySignal<string>;
  /** Whether the note takes edits now; overrides `status` and `cap`. */
  writable?: () => boolean;
}

export interface InTabPeer {
  readonly person: PeerPerson;
  readonly doc: Y.Doc;
  readonly editor: LexicalEditorWithDispose;
  readonly binding: YBinding;
  readonly awareness: Awareness;
  /** Whether an edit would be written now: the note and the peer's binding take edits. */
  writable(): boolean;
  /**
   * Runs `fn` as a Lexical update of the peer's editor, committed at once,
   * then publishes the peer's caret. Its writes reach the note's document
   * before this returns. Does nothing, and returns false, when the note is
   * read only or full, or the peer is disposed. Never throws: a peer must not
   * break the page.
   */
  edit(fn: () => void): boolean;
  /** Publishes the peer's current selection as its caret (null hides it). */
  publishCursor(): void;
  /**
   * Writes the registry entry now. Edits write it on the first change and
   * refresh it at most every ten minutes, so a peer that only shows its caret
   * adds nothing to the note.
   */
  touch(): void;
  /** Leaves: its presence is removed everywhere, its writes stay. */
  dispose(): void;
}

/** The origin of the host's updates applied to a peer. */
const FROM_HOST = Symbol('jot-peer-from-host');

/**
 * Joins `host` with a new peer. The host's document must already hold the
 * note (after the first sync): the peer starts from a copy of it. Every peer
 * gets a new Yjs client id, never a reused one: a client id writing against a
 * stale copy would mint items whose ids already exist elsewhere. Blame groups
 * a person's client ids by their stable person id instead.
 */
export function createInTabPeer(host: PeerHost, person: PeerPerson): InTabPeer {
  const doc = createYDoc();
  // The origin of the peer's updates applied to the host: unique per peer, so
  // each peer only skips its own echo.
  const fromPeer = { peer: person.personId };

  // Start from the note as it is, before the binding reads it.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(host.doc), FROM_HOST);

  let touchedAs = -1;
  const onHostUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== fromPeer) {
      Y.applyUpdate(doc, update, FROM_HOST);
      if (touchedAs !== -1 && doc.clientID !== touchedAs) {
        // Yjs gave the peer a new id (an update wrote to its old one): name it.
        touch();
      }
    }
  };
  const onPeerUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== FROM_HOST) {
      Y.applyUpdate(host.doc, update, fromPeer);
    }
  };
  host.doc.on('update', onHostUpdate);
  doc.on('update', onPeerUpdate);

  const editor = buildEditorFromExtensions(
    defineExtension({
      dependencies: [
        jotEditorExtension,
        // Already synced (a copy of the host); no undo: peers never undo.
        configExtension(YCollabExtension, {
          doc,
          schemaVersion: SCHEMA_VERSION,
          synced: true,
          captureTimeout: null,
        }),
      ],
      name: `jot/peer/${person.personId}`,
      onWarn: (warning) => {
        console.warn(warning);
      },
    }),
  );
  const collab = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  const { binding } = collab;

  let touchedAt = 0;
  function touch() {
    touchedAs = doc.clientID;
    touchedAt = Date.now();
    try {
      writeEntry(doc, doc.clientID, {
        personId: person.personId,
        name: person.name,
        color: person.color,
        kind: person.kind,
        askedBy: person.askedBy,
        seen: Math.floor(Date.now() / 1000),
      });
    } catch {
      // Blame without a name is still blame.
    }
  }

  // Whether the peer's own transactions changed the note (an insert or a
  // deletion), the way the registry tracks people.
  let changed = false;
  const onPeerTransaction = (tr: Y.Transaction) => {
    if (
      tr.local &&
      tr.origin !== REGISTRY_ORIGIN &&
      (tr.insertSet.clients.has(doc.clientID) || !tr.deleteSet.isEmpty())
    ) {
      changed = true;
    }
  };
  doc.on('afterTransaction', onPeerTransaction);

  const hostWritable = (): boolean => {
    if (host.writable !== undefined) {
      return host.writable();
    }
    return (
      (host.status === undefined || host.status.peek() === 'active') &&
      (host.cap === undefined || host.cap.peek() !== 'full')
    );
  };
  const writable = () => !disposed && collab.status.peek() === 'active' && hostWritable();

  // Presence: the peer's own Awareness, relayed into the host's. Every state
  // change (and the 15 s renewal) is applied there, and the provider sends it.
  const awareness = new Awareness(doc);
  const relay = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    const changed = [...added, ...updated, ...removed];
    if (changed.length > 0) {
      applyAwarenessUpdate(host.awareness, encodeAwarenessUpdate(awareness, changed), fromPeer);
    }
  };
  awareness.on('update', relay);
  awareness.setLocalState({ user: { name: person.name, color: person.color }, cursor: null });

  let lastCursor = 'null';
  const publishCursor = () => {
    const cursor = binding.getCursor();
    const encoded = JSON.stringify(cursor);
    if (encoded !== lastCursor) {
      lastCursor = encoded;
      awareness.setLocalStateField('cursor', cursor);
    }
  };

  const announce = () => {
    const state = awareness.getLocalState();
    if (state !== null) {
      // The relay answers the page's lost socket with a removal one clock
      // past the last state it saw, and every client keeps that clock: step
      // past it, or they would refuse the state as already removed.
      awareness.setLocalState(state);
      awareness.setLocalState(state);
    }
  };
  const stopConnection = host.connection?.subscribe((value) => {
    if (value === 'connected') {
      announce();
    }
  });

  let disposed = false;
  return {
    person,
    doc,
    editor,
    binding,
    awareness,
    writable,
    edit(fn) {
      if (!writable()) {
        return false;
      }
      let ok = true;
      changed = false;
      try {
        editor.update(
          () => {
            try {
              fn();
            } catch (error) {
              ok = false;
              console.warn(error);
            }
          },
          { discrete: true },
        );
        publishCursor();
        if (changed && (touchedAs !== doc.clientID || Date.now() - touchedAt >= SEEN_REFRESH_MS)) {
          touch();
        }
      } catch (error) {
        ok = false;
        console.warn(error);
      }
      return ok;
    },
    publishCursor,
    touch,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopConnection?.();
      // Removes the peer's presence (relayed) before it stops relaying.
      awareness.destroy();
      awareness.off('update', relay);
      host.doc.off('update', onHostUpdate);
      doc.off('update', onPeerUpdate);
      doc.off('afterTransaction', onPeerTransaction);
      editor.dispose();
      doc.destroy();
    },
  };
}
