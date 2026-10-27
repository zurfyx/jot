import * as stylex from '@stylexjs/stylex';

/*
 * Markers for the landing page's relational styles (stylex.when.*): a style
 * on one element that follows the state of another, as descendant selectors
 * did in plain CSS.
 */

/** The fan's cards: hovering or focusing inside spreads the fan. */
export const fanMarker = stylex.defineMarker();

/** A card you can open: hovering or focusing it shows its Open button. */
export const cardMarker = stylex.defineMarker();

/** The example card: hovering or focusing it tilts the New note card in front. */
export const exampleMarker = stylex.defineMarker();

/** A feature tab: hovering it darkens its title. */
export const tabMarker = stylex.defineMarker();
