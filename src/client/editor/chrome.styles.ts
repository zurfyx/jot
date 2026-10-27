import * as stylex from '@stylexjs/stylex';

import { colors, motion } from '../theme/tokens.stylex';

/*
 * The note's top bar buttons (Share, Reconnect) and the "Link copied" swap,
 * shared by the chrome and the example note's banner (D28).
 */

const fadeIn = stylex.keyframes({ from: { opacity: 0 } });

export const buttonSmall = stylex.create({
  base: {
    display: 'inline-flex',
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    alignItems: 'center',
    height: '32px',
    paddingBlock: 0,
    paddingInline: '11px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'ease-out',
    color: { default: null, ':disabled': colors['--muted'] },
    cursor: { default: null, ':disabled': 'default' },
  },
});

/** A label that fades in when it changes (keyed on its text). */
export const swap = stylex.create({
  label: {
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
});
