/**
 * The landing page's keyboard paths, as pure functions so they can be tested
 * without a DOM: ⌘↵ (Ctrl+Enter off Mac) starts a note from anywhere, and so
 * does any printable key typed outside a field.
 */

/** The parts of a KeyboardEvent the decisions read. */
export type KeyInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  /** What the event target is: a field, another control, or the page. */
  target: 'field' | 'control' | 'page';
};

export type KeyAction = 'start' | null;

/** ⌘↵ on Mac, Ctrl+Enter elsewhere. Both modifiers are accepted everywhere. */
export function isStartShortcut(input: KeyInput): boolean {
  return input.key === 'Enter' && (input.metaKey || input.ctrlKey) && !input.altKey;
}

/** A key that types a character: one code point, no command modifier. */
export function isPrintableKey(input: KeyInput): boolean {
  if (input.metaKey || input.ctrlKey || input.altKey || input.isComposing) {
    return false;
  }
  return [...input.key].length === 1;
}

export function landingKeyAction(input: KeyInput): KeyAction {
  if (isStartShortcut(input)) {
    return 'start';
  }
  if (!isPrintableKey(input) || input.target === 'field') {
    return null;
  }
  // Space activates the focused button or link; leave it to the browser.
  if (input.key === ' ' && input.target === 'control') {
    return null;
  }
  return 'start';
}

/** Classifies a DOM event target for `landingKeyAction`. */
export function classifyTarget(target: EventTarget | null): KeyInput['target'] {
  if (!(target instanceof Element)) {
    return 'page';
  }
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
    return 'field';
  }
  if (target.closest('button, a[href], [role="tab"], summary')) {
    return 'control';
  }
  return 'page';
}

export function isApplePlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/** The label of the start shortcut on this platform. */
export function startShortcutLabel(platform: string): string {
  return isApplePlatform(platform) ? '⌘↵' : 'Ctrl ↵';
}
