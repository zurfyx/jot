import { useEffect } from 'react';

/**
 * Marks <html> with `data-hydrated` once the page's content has committed
 * (D31): for a prerendered page, once React has hydrated all of it, a lazy
 * page's boundary included, so any mismatch has been reported by then. App
 * marks every page but the docs, whose page marks itself when its own chunk
 * has loaded and hydrated. Tests wait for it before they act on a page.
 */
export function useHydratedMark(ready: boolean): void {
  useEffect(() => {
    if (ready) {
      document.documentElement.dataset.hydrated = '';
    }
  }, [ready]);
}
