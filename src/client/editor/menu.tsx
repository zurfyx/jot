import * as stylex from '@stylexjs/stylex';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { colors, motion } from '../theme/tokens.stylex';
import { Icon, type IconName } from './icons';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/*
 * jot's own menus and popovers, not Astryx's DropdownMenu or Popover (D28):
 * those focus the menu even when it opens from the pointer (Aa must leave the
 * caret and selection in the note), open on press-down, give focus back to
 * the trigger on Escape (jot gives it to the note), cap a menu at 300px,
 * render in the top layer anchored to the trigger (jot's sit in the dock's
 * stacking context, centred on the dock, always above it), enter with a
 * scale, and can't swap ⋯ in place for the Note info and AI model panels.
 */

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

/** A popover rises into place from just below its resting point. */
const menuUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translate(-50%, 6px)' },
});

/**
 * The popover shell: above the dock, centred on it (its containing block is
 * the dock, the nearest positioned ancestor). Panels add their width and
 * padding after it.
 */
const popoverStyles = stylex.create({
  popover: {
    position: 'absolute',
    bottom: 'calc(100% + 10px)',
    left: '50%',
    width: 'min(260px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 120px)',
    overflowY: 'auto',
    padding: 6,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 12,
    backgroundColor: colors['--bg'],
    boxShadow: `0 14px 40px ${colors['--shadow']}`,
    fontSize: 14,
    transform: 'translateX(-50%)',
    animationName: menuUp,
    animationDuration: motion['--pop'],
    animationTimingFunction: motion['--ease'],
    outlineStyle: { default: null, ':focus': 'none' },
  },
});

/**
 * A popover's props: the shell's styles, then a panel's own, and the
 * `data-popover` marker clickToFocus.ts reads (a press outside an open
 * popover only closes it).
 */
export function popoverProps(...panel: stylex.StyleXStyles[]) {
  return { ...stylex.props(popoverStyles.popover, ...panel), 'data-popover': '' };
}

/** A menu row and its parts, shared by every menu (Aa, ⋯, blame's legend). */
export const menuStyles = stylex.create({
  item: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: 8,
    color: { default: colors['--ink'], ':disabled': colors['--muted'] },
    textAlign: 'left',
    lineHeight: 1.3,
    backgroundColor: {
      default: null,
      ':not(:disabled):hover': colors['--hover'],
      ':focus-visible': colors['--hover'],
    },
    outlineStyle: { default: null, ':hover': 'none', ':focus-visible': 'none' },
    cursor: { default: null, ':disabled': 'default' },
  },
  /** A chosen menuitemradio (Aa's current block type). */
  itemChecked: {
    backgroundColor: colors['--select'],
    color: colors['--accent'],
  },
  icon: {
    color: colors['--muted'],
  },
  iconChecked: {
    color: colors['--accent'],
  },
  label: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  /** A text glyph in an icon's place (H1, H2, H3). */
  glyph: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: 16,
    color: colors['--muted'],
    fontSize: '10.5px',
    fontWeight: 700,
    lineHeight: '16px',
    textAlign: 'center',
  },
  hint: {
    color: colors['--muted'],
    fontSize: '12.5px',
  },
  separator: {
    height: 1,
    marginBlock: 5,
    marginInline: 4,
    backgroundColor: colors['--rule'],
  },
});

/** A switch: the knob slides when the toggle changes. */
const switchStyles = stylex.create({
  track: {
    position: 'relative',
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    width: 30,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors['--rule-strong'],
    transitionProperty: 'background-color',
    transitionDuration: motion['--enter'],
    transitionTimingFunction: motion['--ease'],
    '::after': {
      content: "''",
      position: 'absolute',
      top: 2,
      left: 2,
      width: 14,
      height: 14,
      borderRadius: '50%',
      backgroundColor: colors['--bg'],
      transitionProperty: 'transform',
      transitionDuration: motion['--enter'],
      transitionTimingFunction: motion['--ease'],
    },
  },
  on: {
    backgroundColor: colors['--accent'],
    '::after': {
      transform: 'translateX(12px)',
    },
  },
});

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
      {...stylex.props(menuStyles.item)}
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
    >
      <Icon name={icon} xstyle={menuStyles.icon} />
      <span {...stylex.props(menuStyles.label)}>{label}</span>
      {hint !== undefined && <span {...stylex.props(menuStyles.hint)}>{hint}</span>}
    </button>
  );
}

/**
 * A menuitemcheckbox with a decorative switch: the row is the control, the
 * switch only shows its state. (Astryx's Switch is a labelled checkbox input:
 * a control of its own, which can't sit inside a menu item.)
 */
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
      {...stylex.props(menuStyles.item)}
      tabIndex={-1}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <Icon name={icon} xstyle={menuStyles.icon} />
      <span {...stylex.props(menuStyles.label)}>{label}</span>
      <span {...stylex.props(switchStyles.track, checked && switchStyles.on)} aria-hidden="true" />
    </button>
  );
}

export function MenuSeparator() {
  return <div {...stylex.props(menuStyles.separator)} role="separator" />;
}
