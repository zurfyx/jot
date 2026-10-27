import { useSyncExternalStore } from 'react';

/**
 * Light and dark themes: a `data-theme` attribute on <html> picks the token
 * set (the dark values are in globals.css). index.html sets it before the
 * first paint; setTheme changes it.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'jot:theme';
const CHANGE_EVENT = 'jot:theme-change';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Calls `onChange` after every setTheme (for useSyncExternalStore). */
export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/** The current theme, following every change. */
export function useThemeName(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme);
}
