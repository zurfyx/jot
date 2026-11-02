import { useEffect } from 'react';

/**
 * Marks <html> with `data-hydrated` once the page's content has committed
 * (D31). Each prerendered page marks itself from inside its own boundary (the
 * landing page, the docs once their chunk has loaded, the 404 page), so React
 * has hydrated all of it, and reported any mismatch, by then; App marks a
 * note's page, which is never prerendered. Tests wait for it before they act
 * on a page.
 */
export function useHydratedMark(ready: boolean): void {
  useEffect(() => {
    if (ready) {
      document.documentElement.dataset.hydrated = '';
    }
  }, [ready]);
}
