import { useSyncExternalStore } from 'react';

/**
<<<<<<< HEAD
 * A small router: `/`, `/new` (a local draft), `/new?example` (the example
 * note), `/n/<id>` and `/docs/<slug>`. History API only, no library.
=======
 * A small router: `/`, `/new` (redirects to a fresh note), `/new?example`
 * (the example note) and `/n/<id>`. History API only, no library.
>>>>>>> 49e8271 (Give a new note its shareable link at once)
 */

const NAVIGATE_EVENT = 'jot:navigate';

export function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/** The current path and query, e.g. `/new?example`. */
export function useLocationPath(): string {
  return useSyncExternalStore(subscribeLocation, currentPath);
}

export function navigate(path: string): void {
  if (path === currentPath()) {
    return;
  }
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo(0, 0);
}

/** Replaces the current entry (no new history step). */
export function redirect(path: string): void {
  window.history.replaceState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export type Route =
  | { name: 'landing' }
  | { name: 'new' }
  | { name: 'example' }
  | { name: 'note'; id: string }
  /** `slug` is '' for the docs home; the docs page checks it against its pages. */
  | { name: 'docs'; slug: string }
  | { name: 'missing' };

/** The route of a path, with or without its query (`/new?example`). */
export function matchRoute(path: string): Route {
  const query = path.indexOf('?');
  const pathname = query < 0 ? path : path.slice(0, query);
  const search = new URLSearchParams(query < 0 ? '' : path.slice(query));
  if (pathname === '/') {
    return { name: 'landing' };
  }
  if (pathname === '/new' || pathname === '/new/') {
    return search.has('example') ? { name: 'example' } : { name: 'new' };
  }
  const note = /^\/n\/([^/]+)\/?$/.exec(pathname);
  if (note !== null) {
    return { name: 'note', id: note[1] ?? '' };
  }
  const docs = /^\/docs(?:\/([^/]+))?\/?$/.exec(pathname);
  if (docs !== null) {
    return { name: 'docs', slug: docs[1] ?? '' };
  }
  return { name: 'missing' };
}
