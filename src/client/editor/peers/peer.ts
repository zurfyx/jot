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
 */
import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
  type ReadonlySignal,
} from '@lexical/extension';
import { type YBinding, YCollabExtension } from '@lexical/y';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from '@y/protocols/awareness';
import * as Y from '@y/y';
import { configExtension, defineExtension, type LexicalEditorWithDispose } from 'lexical';

import { type PersonKind, writeEntry } from '../blame/registry';
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
}

export interface InTabPeer {
  readonly person: PeerPerson;
  readonly doc: Y.Doc;
  readonly editor: LexicalEditorWithDispose;
  readonly binding: YBinding;
  readonly awareness: Awareness;
  /**
   * Runs `fn` as a Lexical update of the peer's editor, committed at once,
   * then publishes the peer's caret. Its writes reach the note's document
   * before this returns. Never throws: a peer must not break the page.
   */
  edit(fn: () => void): boolean;
  /** Publishes the peer's current selection as its caret (null hides it). */
  publishCursor(): void;
  /** Refreshes the registry entry's last-seen time. */
  touch(): void;
  /** Leaves: its presence is removed everywhere, its writes stay. */
  dispose(): void;
}

/** The origin of the host's updates applied to a peer. */
const FROM_HOST = Symbol('jot-peer-from-host');

/**
 * Joins `host` with a new peer. The host's document must already hold the
 * note (after the first sync): the peer starts from a copy of it.
 */
export function createInTabPeer(host: PeerHost, person: PeerPerson): InTabPeer {
  const doc = new Y.Doc();
  // The origin of the peer's updates applied to the host: unique per peer, so
  // each peer only skips its own echo.
  const fromPeer = { peer: person.personId };

  // Start from the note as it is, before the binding reads it.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(host.doc), FROM_HOST);

  const onHostUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== fromPeer) {
      Y.applyUpdate(doc, update, FROM_HOST);
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
        configExtension(YCollabExtension, { doc, synced: true, captureTimeout: null }),
      ],
      name: `jot/peer/${person.personId}`,
      onWarn: (warning) => {
        console.warn(warning);
      },
    }),
  );
  const { binding } = getExtensionDependencyFromEditor(editor, YCollabExtension).output;

  const touch = () => {
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
  };
  touch();

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
      // A new clock, so peers that dropped the old state take it again.
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
    edit(fn) {
      if (disposed) {
        return false;
      }
      let ok = true;
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
      editor.dispose();
      doc.destroy();
    },
  };
}
