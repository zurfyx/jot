import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';

import { generateNoteId, notePath } from '../../shared/ids';
import { loadNotePage } from '../loadNote';
import { navigate } from '../router';

/** Where the example actions go: a new shared example note (D20). */
export const EXAMPLE_PATH = '/new?example';

/** The shared view-transition name: a card on the landing page, then the note page. */
export const NOTE_TRANSITION_NAME = 'jot-note';

let opening = false;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
}

/**
 * Resolves once `check` holds, or after `timeoutMs`. Polls with timers, not
 * animation frames: rendering (and so rAF) is paused while a view
 * transition's update callback runs.
 */
function until(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (check() || performance.now() > deadline) {
        resolve();
      } else {
        window.setTimeout(tick, 16);
      }
    };
    tick();
  });
}

/**
 * Opens a note from the landing page. The editor chunk loads first, with the
 * page still live, so a cold start never freezes it inside the transition.
 * Then, with the View Transition API, `card` (when it's on screen) grows into
 * the note page: it carries the shared name in the old state and `#root`
 * carries it in the new one. Under reduced motion the pages cross-fade briefly
 * (landing.css); without the API they just switch.
 */
export async function openNote(
  to: string | (() => Promise<string>),
  card: HTMLElement | null = null,
): Promise<void> {
  if (opening) {
    return;
  }
  opening = true;
  try {
    await transitionTo(to, card);
  } catch {
    // Whatever failed, the latch never sticks.
    opening = false;
  }
}

async function transitionTo(
  to: string | (() => Promise<string>),
  card: HTMLElement | null,
): Promise<void> {
  try {
    await loadNotePage();
  } catch {
    // Offline or a stale deploy: switch pages and let the route load it.
  }
  // A fresh note's id (and a legacy draft's claim on it) is settled only now,
  // when the note really opens: a page closed during a slow load claims nothing.
  let path: string;
  try {
    path = typeof to === 'string' ? to : await to();
  } catch {
    path = notePath(generateNoteId());
  }
  const go = () => navigate(path);
  if (typeof document.startViewTransition !== 'function') {
    opening = false;
    go();
    return;
  }

  const root = document.getElementById('root');
  const shared =
    card !== null &&
    card.isConnected &&
    root !== null &&
    !prefersReducedMotion() &&
    isOnScreen(card);
  if (shared) {
    card.style.viewTransitionName = NOTE_TRANSITION_NAME;
  }

  const transition = document.startViewTransition(async () => {
    flushSync(go);
    // The note page's (loaded) chunk mounts a moment later.
    await until(() => root?.querySelector('.note-page') != null, 1500);
    if (shared) {
      root.style.viewTransitionName = NOTE_TRANSITION_NAME;
    }
  });
  // A skipped transition rejects `ready`; the pages still switch.
  transition.ready.catch(() => undefined);
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      opening = false;
      if (root !== null) {
        root.style.viewTransitionName = '';
      }
    });
}

/**
 * A click handler for a link that opens a note: a plain click runs `action`,
 * and a modified or middle click opens the link in a new tab the browser's way.
 */
export function plainClick(action: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    action();
  };
}
