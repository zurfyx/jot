import { useSyncExternalStore } from 'react';

import { generateNoteId, notePath } from '../shared/ids';
import { matchRoute, redirect, subscribeLocation } from './router';

/**
 * The page-level side of the example note (D20), kept free of Lexical and
 * Yjs so the landing page can import it. `/new?example` creates a real
 * shared note at once: it gets an id here, its page connects, seeds the
 * example after the first sync, and moves the address to `/n/<id>`.
 *
 * The tab that created an example remembers it in sessionStorage: only that
 * tab runs the demo collaborators. A reload keeps them (sessionStorage
 * survives it); other windows see their edits through the relay.
 */

const FLAG_PREFIX = 'jot:example:';

/** `new`: the demo has not played yet. `played`: it has, in this tab. */
export type ExampleFlag = 'new' | 'played';

export function readExampleFlag(id: string): ExampleFlag | null {
  try {
    const value = sessionStorage.getItem(`${FLAG_PREFIX}${id}`);
    return value === 'new' || value === 'played' ? value : null;
  } catch {
    return null;
  }
}

export function writeExampleFlag(id: string, flag: ExampleFlag): void {
  try {
    sessionStorage.setItem(`${FLAG_PREFIX}${id}`, flag);
  } catch {
    // Private mode without storage: the demo still runs in this page.
  }
}

/** The example `/new?example` opens, until its page moves to `/n/<id>`. */
let pending: string | null = null;
/** Pages whose session storage refused the flag still know their example. */
const created = new Set<string>();

function read(): string | null {
  const route = matchRoute(window.location.pathname + window.location.search);
  if (route.name === 'example' && pending === null) {
    pending = generateNoteId();
    created.add(pending);
    writeExampleFlag(pending, 'new');
  }
  return route.name === 'example' ? pending : null;
}

/** The id of the example `/new?example` opens; null on any other route. */
export function useExampleId(): string | null {
  return useSyncExternalStore(subscribeLocation, read);
}

/** Whether this tab created example `id` (and so runs its demo). */
export function isExampleCreator(id: string): boolean {
  return created.has(id) || readExampleFlag(id) !== null;
}

/**
 * The example is seeded: show its link in the address bar (same page, no
 * new history entry). The next `/new?example` creates another example.
 */
export function adoptExample(id: string): void {
  if (pending === id) {
    pending = null;
  }
  if (window.location.pathname !== notePath(id)) {
    redirect(notePath(id));
  }
}
