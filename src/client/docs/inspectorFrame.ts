import * as stylex from '@stylexjs/stylex';

import { colors } from '../theme/tokens.stylex';

/**
 * The inspector's frame: the editor beside the Yjs rows, stacked under
 * 1080px. Its own file, so the page shows the frame while the inspector (and
 * Lexical with it) loads.
 */
export const frame = stylex.create({
  box: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(0, 1.2fr)',
      '@media (max-width: 1080px)': 'minmax(0, 1fr)',
    },
    minHeight: 260,
    marginTop: 22,
    marginInline: 0,
    marginBottom: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 14,
  },
  loading: {
    backgroundColor: colors['--hover'],
  },
});
