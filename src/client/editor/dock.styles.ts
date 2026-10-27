import * as stylex from '@stylexjs/stylex';

import { colors, motion } from '../theme/tokens.stylex';

/* The dock's buttons and the icon toggles of its menus. */

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
});

export const dockButton = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 34,
    minWidth: 34,
    paddingInline: 10,
    borderRadius: 10,
    color: { default: colors['--ink'], ':disabled': colors['--muted'] },
    fontSize: '13.5px',
    fontWeight: 650,
    lineHeight: 1,
    backgroundColor: {
      default: 'transparent',
      ':not(:disabled):hover': colors['--hover'],
      '[aria-expanded="true"]': colors['--hover'],
    },
    cursor: { default: 'pointer', ':disabled': 'default' },
    transitionProperty: 'background-color, color',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
  },
  /** "✦ Ask AI…": a field-like button (D21). */
  ask: {
    minWidth: { default: 190, '@media (max-width: 480px)': 0 },
    justifyContent: 'flex-start',
    backgroundColor: {
      default: colors['--hover'],
      ':not(:disabled):hover': colors['--rule'],
      '[aria-expanded="true"]': colors['--rule'],
    },
    color: {
      default: colors['--muted'],
      ':not(:disabled):hover': colors['--ink'],
      '[aria-expanded="true"]': colors['--ink'],
    },
    fontWeight: 500,
  },
  askBusy: {
    color: colors['--ai'],
  },
  /** "Blame ●●●": quiet accent on --select, fading in when blame shows. */
  blame: {
    backgroundColor: colors['--select'],
    color: colors['--accent'],
    animationName: fadeIn,
    animationDuration: motion['--enter'],
    animationTimingFunction: motion['--ease'],
  },
  /** Aa's inline formats: square icon toggles (menuitemcheckbox). */
  format: {
    paddingInline: 0,
    backgroundColor: {
      default: 'transparent',
      ':not(:disabled):hover': colors['--hover'],
    },
    opacity: { default: 1, ':disabled': 0.5 },
  },
  formatChecked: {
    backgroundColor: colors['--select'],
    color: colors['--accent'],
  },
});

/** The Ask AI panel's buttons: Ask, Stop and Download (dark), Not now and Delete (quiet). */
export const panelButton = stylex.create({
  go: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: 9,
    backgroundColor: colors['--btn'],
    color: colors['--btn-ink'],
    fontSize: '12.5px',
    fontWeight: 650,
    lineHeight: 1,
    opacity: { default: null, ':disabled': 0.35 },
    cursor: { default: null, ':disabled': 'default' },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
  },
  quiet: {
    paddingBlock: 7,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: colors['--rule'],
      ':not(:disabled):hover': colors['--rule-strong'],
      ':focus-visible': colors['--rule-strong'],
    },
    borderRadius: 9,
    backgroundColor: {
      default: null,
      ':not(:disabled):hover': colors['--hover'],
      ':focus-visible': colors['--hover'],
    },
    color: colors['--body'],
    fontSize: '12.5px',
    fontWeight: 500,
    lineHeight: 1,
    outlineStyle: { default: null, ':not(:disabled):hover': 'none', ':focus-visible': 'none' },
    opacity: { default: null, ':disabled': 0.45 },
    cursor: { default: null, ':disabled': 'default' },
  },
});
