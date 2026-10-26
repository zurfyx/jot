import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BlameSnapshot, EMPTY_SNAPSHOT } from './attribution';
import { createBlameState } from './state';

const snapshot: BlameSnapshot = { ...EMPTY_SNAPSHOT, total: 5 };

describe('blame state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flashes blame for a few seconds when it is off', () => {
    const state = createBlameState(4000);
    state.flash();
    expect(state.visible.value).toBe(true);
    expect(state.on.value).toBe(false);
    vi.advanceTimersByTime(3999);
    expect(state.visible.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state.visible.value).toBe(false);
  });

  it('leaves blame on when it already was', () => {
    const state = createBlameState(4000);
    state.setOn(true);
    state.flash();
    vi.advanceTimersByTime(5000);
    expect(state.visible.value).toBe(true);
  });

  it('keeps a choice made during a flash', () => {
    const state = createBlameState(4000);
    state.flash();
    state.setOn(true);
    vi.advanceTimersByTime(5000);
    expect(state.visible.value).toBe(true);
    state.setOn(false);
    expect(state.visible.value).toBe(false);
  });

  it('keeps its snapshot and focus when turned on during a flash', () => {
    const state = createBlameState(4000);
    const shown: boolean[] = [];
    state.visible.subscribe((visible) => shown.push(visible));
    state.flash();
    state.setSnapshot(snapshot);
    state.setFocus('ana');
    state.setOn(true);
    expect(state.snapshot.value).toBe(snapshot);
    expect(state.focus.value).toBe('ana');
    // Never hidden in between.
    expect(shown).toEqual([false, true]);
    vi.advanceTimersByTime(5000);
    expect(state.snapshot.value).toBe(snapshot);
  });

  it('keeps its snapshot when a flash restarts', () => {
    const state = createBlameState(4000);
    state.flash();
    state.setSnapshot(snapshot);
    vi.advanceTimersByTime(3000);
    state.flash();
    expect(state.snapshot.value).toBe(snapshot);
    vi.advanceTimersByTime(3999);
    expect(state.visible.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state.visible.value).toBe(false);
    expect(state.snapshot.value).toBe(EMPTY_SNAPSHOT);
  });

  it('clears the focus when blame hides', () => {
    const state = createBlameState(4000);
    state.setOn(true);
    state.setFocus('ana');
    state.setOn(false);
    expect(state.focus.value).toBeNull();
  });
});
