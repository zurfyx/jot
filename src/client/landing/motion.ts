import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * Whether the person asked for reduced motion; follows changes live. A
 * prerendered page renders with motion, and hydrates into the person's choice.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Whether `element` is on screen in a visible tab, so looping motion can
 * pause when nobody can see it. True until the observer first reports.
 */
export function useOnScreen(element: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const target = element.current;
    if (target === null || typeof IntersectionObserver !== 'function') {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) {
        setInView(entry.isIntersecting);
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);

  return inView && visible;
}
