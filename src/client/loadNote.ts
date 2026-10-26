/**
 * The note page's chunk: the editor, Lexical and Yjs. The landing page never
 * imports it statically; it prefetches it on intent (hovering a start action)
 * so the view transition into the editor doesn't wait on the network.
 */
export const loadNotePage = () => import('./editor/NotePage');

let prefetched = false;

export function prefetchNotePage(): void {
  if (prefetched) {
    return;
  }
  prefetched = true;
  loadNotePage().catch(() => {
    prefetched = false;
  });
}
