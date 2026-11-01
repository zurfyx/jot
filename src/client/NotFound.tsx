import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect } from 'react';

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

  return (
    <Message kicker="404" title="This page doesn't exist.">
      The link may be mistyped, or the page may have moved.
    </Message>
  );
}

/**
 * What a note's shell shows inside <noscript> (scripts/prerender.ts): a note
 * is edited live, in the browser. It shares the 404 page's styles, which ship
 * in the entry stylesheet the shell links.
 */
export function NoScriptNotice() {
  return (
    <Message kicker="jot" title="jot needs JavaScript to edit notes.">
      Turn JavaScript on and reload this page. The home page and the docs work without it.
    </Message>
  );
}

/** A page with one message: a kicker, a heading, a line, and a link home. */
function Message({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.code)}>{kicker}</p>
      <h1 {...stylex.props(styles.title)}>{title}</h1>
      <p {...stylex.props(styles.text)}>{children}</p>
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
