import * as stylex from '@stylexjs/stylex';

import { colors } from '../theme/tokens.stylex';

/** The landing page's sections below the hero: their spacing, eyebrow, title and lede. */
export const section = stylex.create({
  section: {
    paddingTop: {
      default: 72,
      '@media (max-width: 760px)': 56,
    },
  },
  eyebrow: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 12,
    color: colors['--ai'],
    fontSize: '12.5px',
    fontWeight: 650,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  title: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 12,
    fontSize: {
      default: 40,
      '@media (max-width: 760px)': 30,
    },
    lineHeight: 1.05,
    fontWeight: 750,
    letterSpacing: '-0.03em',
  },
  sub: {
    maxWidth: '34em',
    marginTop: 0,
    marginInline: 0,
    marginBottom: 30,
    color: colors['--muted'],
    fontSize: 17,
    lineHeight: 1.55,
  },
});
