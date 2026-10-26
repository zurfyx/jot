/** Small drawing pieces shared by the landing page's illustrations. */

import type { ReactNode } from 'react';

export type Who = 'you' | 'ana' | 'ai';

/** A person's caret, with their name when they're someone else. */
export function Caret({ who, name }: { who?: Who; name?: string }) {
  return (
    <span className={`caret${who ? ` is-${who}` : ''}`} aria-hidden="true">
      {name !== undefined && <span className="caret-name">{name}</span>}
    </span>
  );
}

/** Text underlined in its author's colour, as blame shows it. */
export function By({ who, children }: { who: Who; children: ReactNode }) {
  return <span className={`by is-${who}`}>{children}</span>;
}

export function Check({ done = false }: { done?: boolean }) {
  return <span className={`check${done ? ' is-done' : ''}`} aria-hidden="true" />;
}

export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor" />
    </svg>
  );
}

export function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 12L12 4M6 4h6v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Overlapping avatars: an initial (or the AI's sparkle) on the person's colour. */
export function Avatars({ people }: { people: [Who, string][] }) {
  return (
    <span className="avatars" aria-hidden="true">
      {people.map(([who, initial]) => (
        <span key={who} className={`avatar is-${who}`}>
          {initial}
        </span>
      ))}
    </span>
  );
}
