import { describe, expect, it } from 'vitest';

import { readOnlyMessage } from './readOnly';

describe('the read-only banner', () => {
  it('names a newer jot for a newer schema or layout, the common case', () => {
    for (const cause of [
      { code: 'schema-newer', schemaVersion: 2 } as const,
      { code: 'layout-newer', layout: 5 } as const,
      null,
    ]) {
      expect(readOnlyMessage(cause)).toMatch(/newer version of jot; reload to edit/);
    }
  });

  it('asks to copy first when the editor holds what the note can’t keep', () => {
    expect(readOnlyMessage({ code: 'unstorable-change', type: 'paragraph' })).toMatch(
      /can’t be saved by this version of jot\. Copy what you need, then reload/,
    );
    expect(readOnlyMessage({ code: 'unreadable-content', type: 'table' })).toMatch(
      /Copy what you need/,
    );
  });
});
