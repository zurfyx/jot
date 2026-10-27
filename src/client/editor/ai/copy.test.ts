import { describe, expect, it } from 'vitest';

import { MESSAGES } from './controller';
import { consentLine, describeTarget, metaLine } from './copy';

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
    const nano = { name: 'Gemini Nano', consent: null };
    const qwen = { name: 'Qwen2.5 0.5B', consent: { bytes: 295_000_000, text: '300 MB' } };
    expect(metaLine(idle, 'checking', block, null)).toBe('Looking for a model on this device…');
    expect(metaLine(idle, 'available', block, nano)).toBe(
      'Rewrites this block · Gemini Nano, on this device',
    );
    expect(metaLine(idle, 'downloadable', block, nano)).toBe(
      'Rewrites this block · Gemini Nano downloads to this device on your first Ask',
    );
    expect(metaLine(idle, 'downloadable', block, qwen)).toBe(
      'Rewrites this block · Qwen2.5 0.5B (300 MB) downloads after you agree',
    );
    expect(metaLine(idle, 'available', { ...block, problem: 'table' }, qwen)).toBe(MESSAGES.table);
    const downloading = { kind: 'downloading', model: 'Gemini Nano', loading: false } as const;
    expect(metaLine({ ...downloading, progress: 0.42 }, 'downloading', block, nano)).toBe(
      'Downloading Gemini Nano · 42% · Esc to cancel',
    );
    expect(metaLine({ ...downloading, progress: null }, 'downloading', block, nano)).toBe(
      'Downloading Gemini Nano · Esc to cancel',
    );
    expect(
      metaLine(
        { kind: 'downloading', model: 'Qwen2.5 0.5B', loading: true, progress: 0.5 },
        'available',
        block,
        qwen,
      ),
    ).toBe('Loading Qwen2.5 0.5B · 50% · Esc to cancel');
    expect(metaLine({ kind: 'thinking' }, 'available', block, nano)).toBe(
      'jot AI is writing… Esc to cancel',
    );
    expect(metaLine({ kind: 'error', message: 'Nope' }, 'available', block, nano)).toBe('Nope');
  });

  it('asks before a download, in a sentence', () => {
    expect(
      metaLine(
        { kind: 'consent', model: 'Qwen2.5 0.5B', size: '300 MB' },
        'downloadable',
        block,
        null,
      ),
    ).toBe('Ask AI needs a 300 MB model on this device (Qwen2.5 0.5B). Download it?');
    expect(consentLine('Qwen3 1.7B', '990 MB')).toBe(
      'Ask AI needs a 990 MB model on this device (Qwen3 1.7B). Download it?',
    );
  });
});
