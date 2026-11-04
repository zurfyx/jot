import { seedYState } from '@lexical/y/headless';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';

import { jotNodesExtension } from '../shared/nodes';
import { SCHEMA_VERSION } from '../shared/schema';
import { shadowReceipt } from './shadow';
import { SHADOW_LAYOUT } from './steps';

describe('shadow receipts (D34)', () => {
  it('migrate a copy of a layout 1 note to the last bundled layout and report it', () => {
    const state = seedYState(
      { extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION },
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('A note')));
      },
    );
    const receipt = shadowReceipt('tag', state);
    expect(receipt).toMatchObject({ note: 'tag', ok: true, from: 1, changed: true, pending: 0 });
    expect(SHADOW_LAYOUT).toBeGreaterThan(1);
  });

  it('skip a note over the size cap', () => {
    expect(shadowReceipt('tag', new Uint8Array(1_100_000))).toMatchObject({
      ok: true,
      skipped: 'size',
    });
  });
});
