import { describe, expect, it } from 'vitest';

import {
  isApplePlatform,
  isPrintableKey,
  isStartShortcut,
  type KeyInput,
  landingKeyAction,
  startShortcutLabel,
} from './keys';

const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: 'page',
  ...extra,
});

describe('the start shortcut', () => {
  it('is ⌘↵ or Ctrl+Enter', () => {
    expect(isStartShortcut(key('Enter', { metaKey: true }))).toBe(true);
    expect(isStartShortcut(key('Enter', { ctrlKey: true }))).toBe(true);
    expect(isStartShortcut(key('Enter'))).toBe(false);
    expect(isStartShortcut(key('Enter', { metaKey: true, altKey: true }))).toBe(false);
  });

  it('works inside fields too', () => {
    expect(landingKeyAction(key('Enter', { metaKey: true, target: 'field' }))).toBe('start');
  });
});

describe('any printable key', () => {
  it('starts a note from the page', () => {
    expect(landingKeyAction(key('a'))).toBe('start');
    expect(landingKeyAction(key('#'))).toBe('start');
    expect(landingKeyAction(key('é'))).toBe('start');
    expect(landingKeyAction(key('😀'))).toBe('start');
  });

  it('is ignored inside a field', () => {
    expect(landingKeyAction(key('a', { target: 'field' }))).toBeNull();
  });

  it('leaves space to scrolling and controls, wherever focus is', () => {
    expect(landingKeyAction(key(' '))).toBeNull();
    expect(landingKeyAction(key(' ', { target: 'control' }))).toBeNull();
    expect(landingKeyAction(key('k', { target: 'control' }))).toBe('start');
  });

  it('ignores non-printable keys, shortcuts and composition', () => {
    for (const k of ['Enter', 'Tab', 'Escape', 'ArrowDown', 'Shift', 'F5', 'Dead']) {
      expect(isPrintableKey(key(k))).toBe(false);
    }
    expect(landingKeyAction(key('c', { metaKey: true }))).toBeNull();
    expect(landingKeyAction(key('r', { ctrlKey: true }))).toBeNull();
    expect(landingKeyAction(key('a', { altKey: true }))).toBeNull();
    expect(landingKeyAction(key('a', { isComposing: true }))).toBeNull();
  });
});

describe('the shortcut label', () => {
  it('follows the platform', () => {
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('iPhone')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
    expect(startShortcutLabel('MacIntel')).toBe('⌘↵');
    expect(startShortcutLabel('Linux x86_64')).toBe('Ctrl ↵');
  });
});
