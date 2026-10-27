import * as stylex from '@stylexjs/stylex';

/*
 * Markers for the note's Lexical theme (extensions.ts, D28): StyleX styles
 * one element through its own class, so a rule about where a node sits (in
 * the editor, in a table cell) reads a marker class on that ancestor.
 */

/** On the editor's root element (`theme.root`). */
export const editorScope = stylex.defineMarker();

/** On table cells, header cells included. */
export const cellScope = stylex.defineMarker();
