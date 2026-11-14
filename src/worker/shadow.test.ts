import { describe, expect, it } from 'vitest';

import { layout1Note } from '../shared/testing/layout1';
import { shadowReceipt } from './shadow';
import { SHADOW_LAYOUT } from './steps';

describe('shadow receipts (D34)', () => {
  it('migrate a copy of a layout 1 note to the last bundled layout and report it', () => {
    // A note as an earlier jot seeded it (this release seeds layout 4).
    const receipt = shadowReceipt('tag', layout1Note('rich'));
    expect(receipt).toMatchObject({ note: 'tag', ok: true, from: 1, changed: true, pending: 0 });
    expect(SHADOW_LAYOUT).toBe(4);
  });

  it('skip a note over the size cap', () => {
    expect(shadowReceipt('tag', new Uint8Array(1_100_000))).toMatchObject({
      ok: true,
      skipped: 'size',
    });
  });
});
