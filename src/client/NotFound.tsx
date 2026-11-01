import * as stylex from '@stylexjs/stylex';
import { useEffect } from 'react';

import { useHydratedMark } from './hydrated';
import { syncHead } from './syncHead';
import { colors, fonts } from './theme/tokens.stylex';

/**
 * A path that matches no page: the Worker answers it with 404.html, which the
 * prerender writes from this page (D31). Reached in the app too, from a link
 * to a docs page that doesn't exist.
 */
export default function NotFound() {
  useEffect(() => {
    syncHead('not-found');
  }, []);
  // The 404 page has hydrated, inside its own boundary (D31).
  useHydratedMark(true);

  return (
    <main {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.code)}>404</p>
      <h1 {...stylex.props(styles.title)}>This page doesn't exist.</h1>
      <p {...stylex.props(styles.text)}>The link may be mistyped, or the page may have moved.</p>
      <a href="/" {...stylex.props(styles.home)}>
        Go to jot
      </a>
    </main>
  );
}

/**
 * What a note's shell shows inside <noscript> (scripts/prerender.ts): a note
 * is edited live, in the browser. It has the 404 page's look, and its styles,
 * which ship in the entry stylesheet the shell links. Only the prerender
 * renders it, so it adds nothing to the app's bundle.
 */
export function NoScriptNotice() {
  return (
    <main {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.code)}>jot</p>
      <h1 {...stylex.props(styles.title)}>jot needs JavaScript to edit notes.</h1>
      <p {...stylex.props(styles.text)}>
        Turn JavaScript on and reload this page. The home page and the docs work without it.
      </p>
      <a href="/" {...stylex.props(styles.home)}>
        Go to jot
      </a>
    </main>
  );
}

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: '100vh',
    paddingBlock: 48,
    paddingInline: 24,
    backgroundColor: colors['--bg'],
    color: colors['--ink'],
    textAlign: 'center',
  },
  code: {
    margin: 0,
    color: colors['--muted'],
    fontFamily: fonts['--mono'],
    fontSize: 14,
  },
  title: {
    fontSize: { default: 34, '@media (max-width: 640px)': 28 },
    lineHeight: 1.15,
    fontWeight: 680,
    letterSpacing: '-0.022em',
  },
  text: {
    maxWidth: '44ch',
    margin: 0,
    color: colors['--body'],
    fontSize: 16,
    lineHeight: 1.6,
  },
  home: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 40,
    marginTop: 12,
    paddingBlock: 0,
    paddingInline: 16,
    borderRadius: 12,
    backgroundColor: colors['--btn'],
    color: colors['--btn-ink'],
    fontSize: 15,
    fontWeight: 650,
    textDecorationLine: 'none',
  },
});
