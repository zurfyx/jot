import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { colors, docs, fonts } from '../theme/tokens.stylex';
import { highlight, type TokenKind } from './highlight';
import type { CodeSource } from './sources';

const COPIED_MS = 1500;

const styles = stylex.create({
  figure: {
    marginTop: 18,
    marginInline: 0,
    marginBottom: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 12,
    backgroundColor: docs['--docs-code-bg'],
  },
  caption: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 7,
    paddingRight: 10,
    paddingLeft: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--rule'],
    color: colors['--muted'],
    fontSize: 12.5,
    fontWeight: 600,
  },
  file: {
    color: {
      default: colors['--muted'],
      ':hover': colors['--ink'],
    },
    fontFamily: fonts['--mono'],
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  copy: {
    marginLeft: 'auto',
    paddingBlock: 3,
    paddingInline: 9,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    borderRadius: 6,
    backgroundColor: {
      default: colors['--bg'],
      ':hover': colors['--hover'],
    },
    color: colors['--ink'],
    fontSize: 12.5,
    fontWeight: 600,
  },
  pre: {
    margin: 0,
    paddingBlock: 14,
    paddingInline: 16,
    overflow: 'auto',
    color: colors['--ink'],
    // `font: 13px/1.65 var(--mono)`: the shorthand also resets the inherited
    // tabular figures.
    fontFamily: fonts['--mono'],
    fontSize: { default: 13, '@media (max-width: 860px)': 12 },
    lineHeight: 1.65,
    fontWeight: 'normal',
    fontVariantNumeric: 'normal',
    tabSize: 2,
  },
});

/** Keywords, strings and numbers tinted; comments muted. */
export const tokens = stylex.create({
  keyword: { color: docs['--docs-code-keyword'] },
  string: { color: docs['--docs-code-string'] },
  number: { color: docs['--docs-code-number'] },
  comment: { color: colors['--muted'], fontStyle: 'italic' },
}) satisfies Record<Exclude<TokenKind, 'plain'>, unknown>;

/** A code block: the file name (linked to its source), a Copy button and the code. */
export function Code({ source }: { source: CodeSource }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard.writeText(source.code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <figure {...stylex.props(styles.figure)} data-testid="docs-code">
      <figcaption {...stylex.props(styles.caption)}>
        {source.href === undefined ? (
          <span>{source.file}</span>
        ) : (
          <a href={source.href} title="View the source on GitHub" {...stylex.props(styles.file)}>
            {source.file}
          </a>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${source.file}`}
          {...stylex.props(styles.copy)}
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre tabIndex={0} {...stylex.props(styles.pre)}>
        <code>
          {highlight(source.code, source.language).map((token, i) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <span key={i} {...stylex.props(tokens[token.kind])}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
