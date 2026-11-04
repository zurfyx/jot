import { MIN_LAYOUT } from '@lexical/y';

/**
 * The oldest layout this page reads, as its handshake states it (D34): the
 * library's floor. Development builds let a test raise it
 * (`localStorage['jot:test-floor']`), to run the layout migration end to end
 * before a release raises the library's own floor. (The binding's own
 * read-only gate stays the library's.)
 */
export function readFloor(): number {
  if (import.meta.env.DEV) {
    try {
      const value = Number(localStorage.getItem('jot:test-floor'));
      if (Number.isSafeInteger(value) && value > MIN_LAYOUT) {
        return value;
      }
    } catch {
      // Storage denied: the library's floor.
    }
  }
  return MIN_LAYOUT;
}
