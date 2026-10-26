import { buildEditorFromExtensions, getExtensionDependencyFromEditor } from '@lexical/extension';
import { describeStorage, YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $getRoot,
  configExtension,
  defineExtension,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { generateNoteId } from '../../../shared/ids';
import { generateImageKey, imagePath } from '../../../shared/images';
import { $targetBetween } from '../ai/markdown';
import { jotEditorExtension } from '../extensions';
import { $createImageNode, $isImageNode, type ImageData } from './ImageNode';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function client(doc: Y.Doc): LexicalEditor {
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test/images',
      dependencies: [jotEditorExtension, configExtension(YCollabExtension, { doc, synced: true })],
    }),
  );
  getExtensionDependencyFromEditor(editor, YCollabExtension).output.binding.initialize();
  cleanups.push(() => editor.dispose());
  return editor;
}

/** Two clients on two documents kept in sync, like two browsers through the relay. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'b') Y.applyUpdate(b, update, 'a');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'a') Y.applyUpdate(a, update, 'b');
  });
  return { a, b, editorA: client(a), editorB: client(b) };
}

function imagesIn(editor: LexicalEditor): ImageData[] {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .filter($isImageNode)
      .map((node) => node.data()),
  );
}

interface YNodeLike {
  toArray(): unknown[];
  getAttr(key: string): unknown;
  setAttr(key: string, value: unknown): void;
}

function storedImage(doc: Y.Doc): YNodeLike {
  const find = (type: YNodeLike): YNodeLike | null => {
    for (const child of type.toArray()) {
      if (typeof child === 'object' && child !== null && 'getAttr' in child) {
        const node = child as YNodeLike;
        if (node.getAttr('s:src') !== undefined) return node;
        const inner = find(node);
        if (inner !== null) return inner;
      }
    }
    return null;
  };
  const found = find(doc.get('lexical-y') as unknown as YNodeLike);
  if (found === null) throw new Error('no stored image');
  return found;
}

describe('ImageNode (D26)', () => {
  const id = generateNoteId();
  const src = imagePath(id, generateImageKey());

  it('is stored by @lexical/y as a node of its own', () => {
    const { editorA } = pair();
    expect(describeStorage(editorA)['jot-image']).toBe('nested');
  });

  it('reaches another client with its path, alt text and size, and no bytes', () => {
    const { a, editorA, editorB } = pair();
    editorA.update(
      () => {
        $getRoot().append($createImageNode({ src, alt: 'A red square', width: 40, height: 30 }));
      },
      { discrete: true },
    );
    expect(imagesIn(editorB)).toEqual([
      { src, alt: 'A red square', width: 40, height: 30, upload: '', started: 0 },
    ]);
    // The whole note stays small: the image is a path, not its bytes.
    expect(Y.encodeStateAsUpdate(a).byteLength).toBeLessThan(400);
  });

  it('turns a peer’s URL, data: or path of another note into no src at all', () => {
    const { b, editorA, editorB } = pair();
    editorA.update(() => $getRoot().append($createImageNode({ src, alt: 'ok' })), {
      discrete: true,
    });
    for (const value of [
      'https://evil.example/tracker.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      `https://jot.rovira.sh${src}`,
      42,
    ]) {
      b.transact(() => storedImage(b).setAttr('s:src', value), 'peer');
      expect(imagesIn(editorA)[0]!.src, String(value)).toBe('');
      expect(imagesIn(editorB)[0]!.src, String(value)).toBe('');
    }
    // A path of another note parses (it is a jot path); the view refuses it.
    const elsewhere = imagePath(generateNoteId(), generateImageKey());
    b.transact(() => storedImage(b).setAttr('s:src', elsewhere), 'peer');
    expect(imagesIn(editorA)[0]!.src).toBe(elsewhere);
  });

  it('parses every value defensively', () => {
    const { b, editorA } = pair();
    editorA.update(() => $getRoot().append($createImageNode({ src })), { discrete: true });
    b.transact(() => {
      const node = storedImage(b);
      node.setAttr('s:alt', 'x'.repeat(1000));
      node.setAttr('s:width', -5);
      node.setAttr('s:height', 1.5);
      node.setAttr('s:upload', '../../etc');
      node.setAttr('s:started', 'yesterday');
    }, 'peer');
    const [image] = imagesIn(editorA);
    expect(image!.alt).toHaveLength(300);
    expect(image).toMatchObject({ width: 0, height: 0, upload: '', started: 0 });
  });

  it('keeps jot AI away from blocks with an image', () => {
    const { editorA } = pair();
    let problem: string | undefined;
    editorA.update(
      () => {
        const before = $createParagraphNode();
        const after = $createParagraphNode();
        $getRoot().clear().append(before, $createImageNode({ src }), after);
        const start = before.selectStart().clone();
        const end = after.selectEnd();
        problem = $targetBetween(start.anchor, end.focus)?.problem;
      },
      { discrete: true },
    );
    expect(problem).toBe('image');
  });
});
