import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import {
  createYDoc,
  isYWarning,
  UNSUPPORTED_LAYOUT_WARNING,
  UNSUPPORTED_SCHEMA_WARNING,
  YCollabExtension,
  type YDoc,
  type YWarning,
} from '@lexical/y';
import { editYState, seedYState } from '@lexical/y/headless';
import { Awareness } from '@y/protocols/awareness';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_VERSION } from '../../shared/schema';
import { jotEditorExtension } from './extensions';
import { createInTabPeer } from './peers/peer';

// D29 and D25: what jot's own editor does with a note it can't keep. These run
// jot's real editor configuration on @lexical/y, the way the page binds it.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});

/** A page's editor on `doc`, bound as session.ts binds it, already synced. */
function openPage(doc: YDoc) {
  const warnings: YWarning[] = [];
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/page',
      dependencies: [
        jotEditorExtension,
        configExtension(YCollabExtension, { doc, schemaVersion: SCHEMA_VERSION, synced: true }),
      ],
      onWarn: (warning) => {
        if (isYWarning(warning)) {
          warnings.push(warning);
        } else {
          throw warning;
        }
      },
    }),
  );
  const collab = getExtensionDependencyFromEditor(editor, YCollabExtension).output;
  cleanups.push(() => {
    editor.dispose();
    doc.destroy();
  });
  const text = () => editor.getEditorState().read(() => $getRoot().getTextContent());
  const type = (words: string) =>
    editor.update(() => $getRoot().getLastChildOrThrow().selectEnd().insertText(words), {
      discrete: true,
    });
  return { editor, binding: collab.binding, status: collab.status, warnings, text, type };
}

/** The config of a jot one schema version ahead: same nodes, a higher version. */
const NEWER = { extensions: [jotEditorExtension], schemaVersion: SCHEMA_VERSION + 1 };

function paragraph(text: string) {
  return () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  };
}

function schemaRecords(doc: Y.Doc): string[] {
  return Object.keys(doc.get('lexical-y').getAttrs()).filter((key) =>
    key.startsWith('lexical-y-schema:'),
  );
}

describe("jot's schema version", () => {
  it('is recorded on the note with its first write, and nothing is read only', () => {
    const page = openPage(createYDoc());
    page.editor.update(paragraph('Plan'), { discrete: true });
    page.binding.initialize();
    const doc = page.binding.doc;
    expect(page.status.value).toBe('active');
    expect(schemaRecords(doc)).toEqual([`lexical-y-schema:${SCHEMA_VERSION}`]);
    expect(page.warnings).toEqual([]);
  });

  it('opens a note a newer jot wrote read only, showing it and writing nothing', () => {
    const doc = createYDoc(seedYState(NEWER, paragraph('From a newer jot')));
    const before = Y.encodeStateAsUpdate(doc);
    const page = openPage(doc);
    expect(page.status.value).toBe('readonly');
    expect(page.editor.isEditable()).toBe(false);
    expect(page.text()).toBe('From a newer jot');
    expect(page.warnings.map(({ code, data }) => ({ code, data }))).toContainEqual({
      code: UNSUPPORTED_SCHEMA_WARNING,
      data: { reason: 'newer', found: SCHEMA_VERSION + 1, supported: SCHEMA_VERSION },
    });

    // Code that changes the editor anyway writes nothing to the note.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    page.type(' and more');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(schemaRecords(doc)).toEqual([`lexical-y-schema:${SCHEMA_VERSION + 1}`]);
  });

  it("turns read only for good the moment a newer jot's first edit arrives", () => {
    const page = openPage(createYDoc());
    page.editor.update(
      () => {
        $getRoot().clear();
        paragraph('Ours')();
      },
      { discrete: true },
    );
    page.binding.initialize();
    const doc = page.binding.doc;
    page.type(', typed here');
    expect(page.status.value).toBe('active');

    // A tab of the newer jot edits the same note; its update reaches this one.
    const { update } = editYState(Y.encodeStateAsUpdate(doc), NEWER, paragraph('Theirs'), {
      writer: null,
    });
    Y.applyUpdate(doc, update!, 'remote');
    expect(page.status.value).toBe('readonly');
    expect(page.editor.isEditable()).toBe(false);
    // It keeps what it showed, its own edits included, and shows the newer edit.
    expect(page.text()).toBe('Ours, typed here\n\nTheirs');
    expect(page.warnings.map(({ code }) => code)).toContain(UNSUPPORTED_SCHEMA_WARNING);

    // A later remote edit still shows; nothing this tab does is written.
    const later = editYState(Y.encodeStateAsUpdate(doc), NEWER, paragraph('Later'), {
      writer: null,
    });
    Y.applyUpdate(doc, later.update!, 'remote');
    expect(page.text()).toBe('Ours, typed here\n\nTheirs\n\nLater');
    const before = Y.encodeStateAsUpdate(doc);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    page.type('!');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(page.status.value).toBe('readonly');
  });

  it("keeps the in-tab peers from writing to a newer jot's note", () => {
    const doc = createYDoc(seedYState(NEWER, paragraph('From a newer jot')));
    expect(openPage(doc).status.value).toBe('readonly');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The host says the note takes edits, as a page that missed the change
    // would: the peer's own binding, on its copy of the note, refuses anyway.
    const awareness = new Awareness(doc);
    const peer = createInTabPeer(
      { doc, awareness, writable: () => true },
      { personId: 'demo-ana', name: 'Ana (demo)', color: 1, kind: 'demo' },
    );
    cleanups.push(() => awareness.destroy());
    cleanups.push(() => peer.dispose());
    const before = Y.encodeStateAsUpdate(doc);
    expect(
      peer.edit(() => {
        $getRoot().getFirstChildOrThrow().selectEnd().insertText(' and Ana');
      }),
    ).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe('a note from before the layout froze (D25)', () => {
  it('opens read only, showing what the binding can read, and is written nothing', () => {
    // What jot's earliest builds wrote: a layout record of their own
    // (`lexical-y` = 2), never today's `lexical-y:<n>` = true.
    const doc = createYDoc();
    const root = doc.get('lexical-y');
    doc.transact(() => {
      root.setAttr('lexical-y', 2);
      root.insert(0, 'An early note');
    });
    const before = Y.encodeStateAsUpdate(doc);
    const page = openPage(doc);
    expect(page.status.value).toBe('readonly');
    expect(page.editor.isEditable()).toBe(false);
    expect(page.text()).toContain('An early note');
    expect(page.warnings.map(({ code, data }) => ({ code, data }))).toContainEqual({
      code: UNSUPPORTED_LAYOUT_WARNING,
      data: expect.objectContaining({ reason: 'missing' }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    page.binding.initialize();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
