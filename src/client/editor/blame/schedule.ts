/**
 * A trailing debounce with a maximum wait: `run` happens `wait` ms after the
 * last call, and never later than `maxWait` ms after the first call of a
 * burst, so a steady stream of calls (someone typing) still runs it.
 */
export function debounceWithMaxWait(
  run: () => void,
  wait: number,
  maxWait: number,
): { schedule(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let since = 0;
  const fire = () => {
    timer = null;
    run();
  };
  return {
    schedule() {
      const now = Date.now();
      if (timer === null) {
        since = now;
      } else {
        clearTimeout(timer);
      }
      timer = setTimeout(fire, Math.min(wait, Math.max(0, since + maxWait - now)));
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
