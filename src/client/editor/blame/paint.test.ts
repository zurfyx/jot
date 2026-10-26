import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mapRuns, type PaintPlan, type Segment } from './paint';

// Node has no DOM: text nodes are stand-ins, and StaticRange keeps its init.
beforeAll(() => {
  globalThis.StaticRange = class {
    constructor(init: StaticRangeInit) {
      Object.assign(this, init);
    }
  } as unknown as typeof StaticRange;
});
afterAll(() => {
  // @ts-expect-error: Node has no StaticRange of its own.
  delete globalThis.StaticRange;
});

const text = (name: string) => ({ name }) as unknown as Text;

describe('mapRuns', () => {
  it('maps runs across text nodes and line breaks', () => {
    const a = text('a');
    const b = text('b');
    // "Hello " + <br> + "world": runs Ana 0-3, Bea 3-10, nobody 10-12.
    const segments: Segment[] = [
      { node: a, start: 0, length: 6 },
      { node: null, start: 6, length: 1 },
      { node: b, start: 7, length: 5 },
    ];
    const plan: PaintPlan = { ranges: new Map(), spans: new Map(), lines: [] };
    mapRuns(plan, segments, [
      { length: 3, personId: 'ana' },
      { length: 7, personId: 'bea' },
      { length: 2, personId: null },
    ]);
    expect(plan.ranges.get('ana')).toEqual([
      { startContainer: a, startOffset: 0, endContainer: a, endOffset: 3 },
    ]);
    expect(plan.ranges.get('bea')).toEqual([
      { startContainer: a, startOffset: 3, endContainer: b, endOffset: 3 },
    ]);
    expect(plan.spans.get(a)).toEqual([
      { start: 0, end: 3, personId: 'ana' },
      { start: 3, end: 6, personId: 'bea' },
    ]);
    expect(plan.spans.get(b)).toEqual([{ start: 0, end: 3, personId: 'bea' }]);
  });

  it('sweeps long lines in linear time', () => {
    const count = 20_000;
    const segments: Segment[] = Array.from({ length: count }, (_, i) => ({
      node: text(String(i)),
      start: i * 2,
      length: 2,
    }));
    const runs = Array.from({ length: count * 2 }, (_, i) => ({
      length: 1,
      personId: i % 2 === 0 ? 'ana' : 'bea',
    }));
    const plan: PaintPlan = { ranges: new Map(), spans: new Map(), lines: [] };
    const started = performance.now();
    mapRuns(plan, segments, runs);
    // Quadratic would be 8e8 steps; linear is instant.
    expect(performance.now() - started).toBeLessThan(500);
    expect(plan.ranges.get('ana')).toHaveLength(count);
    expect(plan.spans.size).toBe(count);
  });
});
