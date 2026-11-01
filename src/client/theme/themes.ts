import * as stylex from '@stylexjs/stylex';

import { colors } from './tokens.stylex';

/*
 * The landing page's light token set (D07, D28): its root puts it on itself.
 * Every dark set, the app's and the landing page's and the docs' scopes, is in
 * globals.css, keyed to `data-theme`, where it applies before the first paint,
 * prerendered pages included (D31).
 */

/** The landing page's scope in light: its background is --landing-bg. */
export const landingLight = stylex.createTheme(colors, {
  '--bg': '#fff',
  '--ink': '#14161a',
  '--body': '#2b2f36',
  '--muted': '#5d636d',
  '--rule': '#e7e8eb',
  '--rule-strong': '#d3d6db',
  '--hover': '#f4f5f7',
  '--accent': '#233f8f',
  '--select': '#dfe7fb',
  '--btn': '#14161a',
  '--btn-ink': '#fff',
  '--ok': '#1a7f37',
  '--warn': '#8a6100',
  '--bad': '#b42318',
  '--shadow': 'rgb(0 0 0 / 0.16)',
  '--shadow-soft': 'rgb(0 0 0 / 0.1)',
  '--scrim': 'rgb(20 22 26 / 0.12)',
  '--scrollbar': 'rgb(20 22 26 / 0.2)',
  '--peer-ink': '#fff',
  '--peer-0': '#1a7f37',
  '--peer-1': '#c2410c',
  '--peer-2': '#7c3aed',
  '--peer-3': '#0e7490',
  '--peer-4': '#be185d',
  '--peer-5': '#a16207',
  '--peer-6': '#2563eb',
  '--peer-7': '#4d7c0f',
  '--ai': 'var(--peer-2)',
  '--ai-tint': 'color-mix(in srgb, var(--peer-2) 12%, transparent)',
  '--blame-faded': '28%',
  '--blame-faded-opacity': '0.32',
  '--landing-bg': '#fff',
});
