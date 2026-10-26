import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debounceWithMaxWait } from './schedule';

describe('debounceWithMaxWait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, a pause after the last call', () => {
    const run = vi.fn();
    const debounced = debounceWithMaxWait(run, 150, 1000);
    debounced.schedule();
    vi.advanceTimersByTime(100);
    debounced.schedule();
    vi.advanceTimersByTime(149);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still runs within the maximum wait while calls keep coming', () => {
    const run = vi.fn();
    const debounced = debounceWithMaxWait(run, 150, 1000);
    // Someone typing every 100 ms for 3 s.
    for (let t = 0; t < 3000; t += 100) {
      debounced.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cancels', () => {
    const run = vi.fn();
    const debounced = debounceWithMaxWait(run, 150, 1000);
    debounced.schedule();
    debounced.cancel();
    vi.advanceTimersByTime(2000);
    expect(run).not.toHaveBeenCalled();
  });
});
