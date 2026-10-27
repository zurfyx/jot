import * as stylex from '@stylexjs/stylex';
import { useSyncExternalStore } from 'react';

import { dark } from './theme/themes';

/**
 * Light and dark themes. index.html sets a `data-theme` attribute on <html>
 * before the first paint; the dark token set is a StyleX theme class (D28),
 * put on <html> here, before anything renders, and on every change.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'jot:theme';
const CHANGE_EVENT = 'jot:theme-change';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Puts the dark token set on <html> when `data-theme` says dark. */
export function applyThemeClass(): void {
  const { className = '' } = stylex.props(currentTheme() === 'dark' && dark);
  document.documentElement.className = className;
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  applyThemeClass();
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
