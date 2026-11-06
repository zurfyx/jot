import { seedYState } from '@lexical/y/headless';
import * as Y from '@y/y';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotNodesExtension } from '../../../shared/nodes';
import { SCHEMA_VERSION } from '../../../shared/schema';
import { readSchemaVersion, renderView } from './render';

function note(text: string): Uint8Array {
  return seedYState({ extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION }, () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  });
}

describe('rendering a record', () => {
  it('reads its source view with jot nodes', () => {
    const rendered = renderView(note('offline paragraph'));
    expect(rendered.ok).toBe(true);
    expect(JSON.stringify(rendered.ok && rendered.editorState)).toContain('offline paragraph');
  });

  it('reads one that records a higher schema version (a legacy signal)', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, note('signalled'));
    doc.get('lexical-y').setAttr(`lexical-y-schema:${SCHEMA_VERSION + 1}`, true);
    const rendered = renderView(Y.encodeStateAsUpdate(doc));
    expect(rendered.ok).toBe(true);
    expect(JSON.stringify(rendered.ok && rendered.editorState)).toContain('signalled');
  });

  it('says why it cannot read bytes that are no state', () => {
    expect(renderView(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });

  it('takes the higher schema version only', () => {
    expect(readSchemaVersion({ [`lexical-y-schema:${SCHEMA_VERSION + 3}`]: true })).toBe(
      SCHEMA_VERSION + 3,
    );
    expect(readSchemaVersion({ 'lexical-y-schema:0': true })).toBe(SCHEMA_VERSION);
  });
});
