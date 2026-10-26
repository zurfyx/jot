import type { ReactNode } from 'react';

/** The dock's icons: 16px strokes in currentColor, from the editor mocks. */

const PATHS = {
  bold: (
    <path
      d="M5 3h4.5a2.5 2.5 0 010 5H5zM5 8h5a2.5 2.5 0 010 5H5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  ),
  italic: (
    <path
      d="M10 3H6.5M9.5 13H6M9 3L7 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  underline: (
    <path
      d="M4.5 3v4.5a3.5 3.5 0 007 0V3M3.5 13.5h9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  strike: (
    <path
      d="M3 8h10M10.5 5.2C10 4 9 3.4 8 3.4c-1.6 0-2.7.9-2.7 2 0 .9.6 1.5 1.6 1.9M5.3 10.8c.4 1.1 1.5 1.8 2.8 1.8 1.6 0 2.8-.9 2.8-2.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  code: (
    <path
      d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  link: (
    <path
      d="M7 9a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.6.6M9 7a2.5 2.5 0 00-3.5 0l-2 2A2.5 2.5 0 007 12.5l.6-.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  text: (
    <path
      d="M3.5 4h9M8 4v9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  bullets: (
    <>
      <path
        d="M6.5 4.5H13M6.5 8H13M6.5 11.5H13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="3.5" cy="4.5" r="1" fill="currentColor" />
      <circle cx="3.5" cy="8" r="1" fill="currentColor" />
      <circle cx="3.5" cy="11.5" r="1" fill="currentColor" />
    </>
  ),
  numbered: (
    <>
      <path
        d="M7 4.5H13M7 8H13M7 11.5H13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M2.6 3.4l1-.6v3.4M2.5 9.6c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .9-2.1 1.6-2.1 2.6h2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  todo: (
    <>
      <rect
        x="2.5"
        y="3"
        width="4"
        height="4"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M3.3 11l1 1 1.7-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 5H13M8.5 11H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  quote: (
    <path
      d="M3 4v8M6.5 5.5H13M6.5 8H13M6.5 10.5H11"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  ),
  codeblock: (
    <>
      <rect
        x="2"
        y="2.5"
        width="12"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M6.5 6.2L4.8 8l1.7 1.8M9.5 6.2L11.2 8 9.5 9.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.2v4M8 4.8v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  copy: (
    <>
      <rect
        x="5"
        y="5"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M3 10.5V4a1 1 0 011-1h6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  offline: (
    <>
      <path
        d="M2 6.2a9 9 0 0112 0M4.3 8.6a5.8 5.8 0 017.4 0M6.6 11a2.5 2.5 0 012.8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  moon: (
    <path
      d="M12.5 10A5 5 0 016 3.5a5 5 0 106.5 6.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  eye: (
    <>
      <path
        d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function isIconName(name: string): name is IconName {
  return Object.hasOwn(PATHS, name);
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
