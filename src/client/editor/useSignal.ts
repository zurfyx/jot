import type { ReadonlySignal } from '@lexical/extension';
import { useSyncExternalStore } from 'react';

/** Reads a signal and re-renders when it changes. */
export function useSignal<T>(source: ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (onChange) => source.subscribe(() => onChange()),
    () => source.value,
  );
}
