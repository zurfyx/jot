import { describe, expect, it } from 'vitest';

import { matchRoute } from '../router';
import { ADVANCE_MS, FEATURES } from './EngineTabs';
import { EXAMPLE_PATH, NEW_NOTE_PATH } from './open';
import { LOOP_MS, PHASE_STARTS, stepOfPhase } from './TwoWindows';

describe("the landing page's destinations", () => {
  it('start and example both resolve to the new-note route', () => {
    const path = (href: string) => new URL(href, 'https://jot.rovira.sh').pathname;
    expect(matchRoute(path(NEW_NOTE_PATH))).toEqual({ name: 'new' });
    expect(matchRoute(path(EXAMPLE_PATH))).toEqual({ name: 'new' });
    expect(new URL(EXAMPLE_PATH, 'https://jot.rovira.sh').searchParams.has('example')).toBe(true);
  });
});

describe('the two-windows story', () => {
  it('plays its phases in order, inside one loop', () => {
    expect([...PHASE_STARTS]).toEqual([...PHASE_STARTS].sort((a, b) => a - b));
    expect(PHASE_STARTS[0]).toBe(0);
    expect(PHASE_STARTS.at(-1)).toBeLessThan(LOOP_MS);
  });

  it('fills the three steps as it goes', () => {
    expect(PHASE_STARTS.map((_, phase) => stepOfPhase(phase))).toEqual([0, 1, 1, 1, 2]);
  });
});

describe('the feature tabs', () => {
  it('are the four features, advancing every 3 s', () => {
    expect(FEATURES.map((feature) => feature.title)).toEqual([
      'Live cursors',
      'Blame',
      'Offline, then merge',
      'AI as a collaborator',
    ]);
    expect(ADVANCE_MS).toBe(3000);
  });
});
