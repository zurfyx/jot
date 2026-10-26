import { describe, expect, it } from 'vitest';

import { MESSAGES } from './controller';
import { describeTarget, metaLine } from './copy';

const block = { blocks: 1, empty: false, list: false, problem: 'none' as const };

describe('Ask AI copy', () => {
  it('says what a request will rewrite', () => {
    expect(describeTarget(null)).toBe(MESSAGES.noTarget);
    expect(describeTarget(block)).toBe('Rewrites this block');
    expect(describeTarget({ ...block, list: true })).toBe('Rewrites the whole list');
    expect(describeTarget({ ...block, empty: true })).toBe('Writes into the empty line');
    expect(describeTarget({ ...block, blocks: 3 })).toBe('Rewrites 3 blocks');
    expect(describeTarget({ ...block, problem: 'table' })).toBe(MESSAGES.table);
  });

  it('says what is happening', () => {
    const idle = { kind: 'idle' } as const;
    expect(metaLine(idle, 'checking', block)).toBe("Looking for Chrome's built-in AI…");
    expect(metaLine(idle, 'available', block)).toBe('Rewrites this block · runs on this device');
    expect(metaLine(idle, 'downloadable', block)).toBe(
      'Rewrites this block · Gemini Nano downloads to this device on your first Ask',
    );
    expect(metaLine({ kind: 'downloading', progress: 0.42 }, 'downloading', block)).toBe(
      'Downloading Gemini Nano · 42% · Esc to cancel',
    );
    expect(metaLine({ kind: 'thinking' }, 'available', block)).toBe(
      'jot AI is writing… Esc to cancel',
    );
    expect(metaLine({ kind: 'error', message: 'Nope' }, 'available', block)).toBe('Nope');
  });
});
