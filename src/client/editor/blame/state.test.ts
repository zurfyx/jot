import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBlameState } from './state';

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

  it('clears the focus when blame hides', () => {
    const state = createBlameState(4000);
    state.setOn(true);
    state.setFocus('ana');
    state.setOn(false);
    expect(state.focus.value).toBeNull();
  });
});
