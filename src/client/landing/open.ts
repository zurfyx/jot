import { flushSync } from 'react-dom';

import { loadNotePage } from '../loadNote';
import { navigate } from '../router';

/** Where the landing page's actions go. `/new?example` behaves like `/new` for now. */
export const NEW_NOTE_PATH = '/new';
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
 * Opens a note from the landing page. With the View Transition API, `card`
 * (when it's on screen) grows into the note page: it carries the shared name
 * in the old state and `#root` carries it in the new one. Under reduced motion
 * the pages cross-fade briefly (styles.css); without the API they just switch.
 */
export function openNote(path: string, card: HTMLElement | null = null): void {
  if (opening) {
    return;
  }
  const go = () => navigate(path);
  if (typeof document.startViewTransition !== 'function') {
    go();
    return;
  }

  opening = true;
  const editor = loadNotePage().catch(() => undefined);
  const root = document.getElementById('root');
  const shared = card !== null && root !== null && !prefersReducedMotion() && isOnScreen(card);
  if (shared) {
    card.style.viewTransitionName = NOTE_TRANSITION_NAME;
  }

  const transition = document.startViewTransition(async () => {
    await editor;
    flushSync(go);
    // `/new` resolves to a note and the editor chunk mounts a moment later.
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
