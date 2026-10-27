import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * jot's Astryx theme (D28): Neutral, the closest built-in (muted, minimal),
 * with its tokens pointed at jot's own (theme/tokens.stylex.ts). jot's tokens
 * already switch with light and dark, so every Astryx token follows them and
 * no `[light, dark]` pair is needed. Built with
 * `pnpm exec astryx theme build src/client/theme/jotTheme.ts`.
 */
export const jotTheme = defineTheme({
  name: 'jot',
  // Neutral's tokens and component styles, without its icon set: jot draws
  // its own icons, and Astryx's built-in fallbacks cover its components, so
  // the app never loads Neutral (or lucide-react) at runtime.
  extends: { ...neutralTheme, icons: {} },
  typography: {
    body: {
      family: 'Geist Variable',
      fallbacks: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    heading: {
      family: 'Geist Variable',
      fallbacks: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    code: { family: 'Geist Mono Variable', fallbacks: "ui-monospace, 'SF Mono', Menlo, monospace" },
  },
  tokens: {
    '--color-accent': 'var(--accent)',
    '--color-on-accent': 'var(--btn-ink)',
    '--color-text-accent': 'var(--accent)',
    '--color-icon-accent': 'var(--accent)',
    '--color-background-body': 'var(--bg)',
    '--color-background-surface': 'var(--bg)',
    '--color-background-card': 'var(--bg)',
    '--color-background-popover': 'var(--bg)',
    '--color-background-muted': 'var(--hover)',
    '--color-background-inverted': 'var(--btn)',
    '--color-text-primary': 'var(--ink)',
    '--color-text-secondary': 'var(--muted)',
    '--color-icon-primary': 'var(--ink)',
    '--color-icon-secondary': 'var(--muted)',
    '--color-border': 'var(--rule)',
    '--color-border-emphasized': 'var(--rule-strong)',
    '--color-overlay-hover': 'var(--hover)',
    '--color-tint-hover': 'var(--hover)',
    '--color-shadow': 'var(--shadow)',
    '--color-success': 'var(--ok)',
    '--color-warning': 'var(--warn)',
    '--color-error': 'var(--bad)',
    '--focus-outline-color': 'var(--accent)',
    '--focus-outline-width': '2px',
    '--focus-outline-style': 'solid',
    '--focus-outline-offset': '2px',
  },
});
