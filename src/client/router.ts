import { useSyncExternalStore } from 'react';

/** A two-route router: `/` and `/n/<id>`. History API only, no library. */

const NAVIGATE_EVENT = 'jot:navigate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string): void {
  if (path === window.location.pathname) {
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

export type Route = { name: 'landing' } | { name: 'note'; id: string } | { name: 'missing' };

export function matchRoute(pathname: string): Route {
  if (pathname === '/') {
    return { name: 'landing' };
  }
  const note = /^\/n\/([^/]+)\/?$/.exec(pathname);
  if (note !== null) {
    return { name: 'note', id: note[1] ?? '' };
  }
  return { name: 'missing' };
}
