import * as stylex from '@stylexjs/stylex';

/*
 * jot's look (docs/design.md, D07, D28). Every colour is a token here, so dark
 * mode is the same styles with the other token set (themes.ts). One accent;
 * status colours carry status only, always beside a word.
 *
 * The names stay literal (`--bg`, not a hash): the global stylesheet's
 * ::highlight() rules read them too.
 */

export const colors = stylex.defineVars({
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
  /* Scrollbars: a thin translucent thumb on no track. */
  '--scrollbar': 'rgb(20 22 26 / 0.2)',
  /* Collaborators' colours: identity, not status. */
  '--peer-ink': '#fff',
  '--peer-0': '#1a7f37',
  '--peer-1': '#c2410c',
  '--peer-2': '#7c3aed',
  '--peer-3': '#0e7490',
  '--peer-4': '#be185d',
  '--peer-5': '#a16207',
  '--peer-6': '#2563eb',
  '--peer-7': '#4d7c0f',
  /* jot AI is violet everywhere; its tint marks the blocks Ask AI will rewrite. */
  '--ai': 'var(--peer-2)',
  '--ai-tint': 'color-mix(in srgb, var(--peer-2) 12%, transparent)',
  /* Blame: how much of a colour people out of focus keep. */
  '--blame-faded': '28%',
  '--blame-faded-opacity': '0.32',
  /* The landing page's background (re-pointed to --bg on the landing page). */
  '--landing-bg': '#fff',
});

export const fonts = stylex.defineVars({
  '--sans': "'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--mono': "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
});

export const motion = stylex.defineVars({
  '--ease': 'cubic-bezier(0.2, 0, 0, 1)',
  '--enter': '180ms',
  '--pop': '220ms',
});

/*
 * The landing page: "Clean" in light, "Night" in dark (D07). Its scope
 * (themes.ts) re-points the base tokens, so its styles read the same names;
 * the people's colours are the peer palette above.
 */
export const landing = stylex.defineVars({
  '--you': 'var(--peer-0)',
  '--ana': 'var(--peer-1)',
  '--card': '#fff',
  '--card-rule': 'rgb(20 22 26 / 0.09)',
  '--card-highlight': 'rgb(255 255 255 / 0.6)',
  '--card-shadow-near': 'rgb(20 20 40 / 0.06)',
  '--card-shadow-mid': 'rgb(20 20 40 / 0.16)',
  '--card-shadow-far': 'rgb(20 20 40 / 0.22)',
  '--card-shadow-lift': 'rgb(20 20 40 / 0.35)',
  '--button-shadow': 'rgb(0 0 0 / 0.35)',
  '--glow-opacity': '0.5',
  '--code-bg': '#0e1015',
  '--code-ink': '#e7e9ee',
  '--code-keyword': '#c4a1ff',
  '--code-string': '#7ee2a0',
  /* The code block is dark in both themes: its scrollbar is always light. */
  '--code-scrollbar': 'rgb(231 233 238 / 0.24)',
});

/*
 * The docs (/docs): the base tokens, plus the example people's colours for
 * the nav and the diagrams, light code blocks and the inspector's highlight.
 */
export const docs = stylex.defineVars({
  '--docs-tint-you': 'color-mix(in srgb, var(--peer-0) 13%, var(--bg))',
  '--docs-tint-ana': 'color-mix(in srgb, var(--peer-1) 12%, var(--bg))',
  '--docs-tint-ai': 'color-mix(in srgb, var(--peer-2) 14%, var(--bg))',
  '--docs-hl': 'color-mix(in srgb, var(--peer-2) 15%, transparent)',
  '--docs-callout-bg': 'color-mix(in srgb, var(--accent) 6%, var(--bg))',
  '--docs-callout-rule': 'color-mix(in srgb, var(--accent) 22%, var(--rule))',
  '--docs-warn-bg': 'color-mix(in srgb, var(--warn) 10%, var(--bg))',
  '--docs-warn-rule': 'color-mix(in srgb, var(--warn) 40%, var(--rule))',
  '--docs-code-bg': '#f8f9fa',
  '--docs-code-keyword': '#8b3fd9',
  '--docs-code-string': '#1a7f37',
  '--docs-code-number': '#0e7490',
});
