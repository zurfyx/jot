import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Icon, type IconName } from './icons';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/**
 * Open state for a popover anchored to a trigger: closes on Escape and on a
 * press outside both, and gives focus back to the trigger when it closes from
 * the keyboard. `viaKeyboard` says whether it was opened from the keyboard
 * (then its first item takes focus; from a pointer the editor keeps it).
 */
export function usePopover<T extends string>(
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
) {
  const [open, setOpen] = useState<T | null>(null);
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback(() => {
    setOpen(null);
    onCloseRef.current?.();
  }, []);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, containerRef]);

  /** Toggle `which` from a click; `detail === 0` means Enter or Space. */
  const toggle = useCallback(
    (which: T, detail = 0) => {
      if (open === which) {
        close();
      } else {
        setViaKeyboard(detail === 0);
        setOpen(which);
      }
    },
    [open, close],
  );

  return { open, setOpen, viaKeyboard, close, toggle };
}

/** Arrow keys, Home and End move between a menu's items. */
export function moveMenuFocus(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) {
    return;
  }
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    (item) => !item.hasAttribute('disabled'),
  );
  if (items.length === 0) {
    return;
  }
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (event.key === 'End') {
    next = items.length - 1;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    next = index < 0 ? 0 : (index + 1) % items.length;
  } else {
    next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
  }
  items[next]?.focus();
}

/** Focuses the first item of `ref` once, when `active`. */
export function useFocusFirstItem(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (active) {
      ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
    }
  }, [ref, active]);
}

/** Keeps the editor's focus and selection when a pointer presses a control. */
export function keepEditorFocus(event: { preventDefault(): void; target: EventTarget }): void {
  if (!(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
  }
}

export function MenuItem({
  icon,
  label,
  hint,
  onSelect,
  disabled,
  testId,
}: {
  icon: IconName;
  label: string;
  hint?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
    >
      <Icon name={icon} />
      <span className="menu-label">{label}</span>
      {hint !== undefined && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export function MenuToggle({
  icon,
  label,
  checked,
  onChange,
  disabled,
}: {
  icon: IconName;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="menu-item"
      tabIndex={-1}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <Icon name={icon} />
      <span className="menu-label">{label}</span>
      <span className={`switch${checked ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}
