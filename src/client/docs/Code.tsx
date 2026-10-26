import { useEffect, useState } from 'react';

import { highlight } from './highlight';
import type { CodeSource } from './sources';

const COPIED_MS = 1500;

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
    <figure className="docs-code">
      <figcaption>
        {source.href === undefined ? (
          <span>{source.file}</span>
        ) : (
          <a href={source.href} title="View the source on GitHub">
            {source.file}
          </a>
        )}
        <button type="button" onClick={copy} aria-label={`Copy ${source.file}`}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {highlight(source.code, source.language).map((token, i) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <span key={i} className={`tok-${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
