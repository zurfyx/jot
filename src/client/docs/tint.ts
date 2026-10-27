import * as stylex from '@stylexjs/stylex';

import { colors } from '../theme/tokens.stylex';

/**
 * The example people's colours, which mark the docs pages and the diagram:
 * you in green, Ana in orange, jot AI in violet (the peer palette).
 */
export const TINT = stylex.create({
  you: { backgroundColor: colors['--peer-0'] },
  ana: { backgroundColor: colors['--peer-1'] },
  ai: { backgroundColor: colors['--ai'] },
});
