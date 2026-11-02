import type { ReactNode } from 'react';

/**
 * A looping illustration's moving frames and its still end frame, both in the
 * HTML (D31). globals.css shows the still one under reduced motion and the
 * moving one otherwise, so a prerendered page shows the right one from its
 * first paint, before any script knows the person's setting, and hydrating
 * changes nothing on screen. The wrappers are `display: contents`: they add no
 * box. `block` wraps block content (a `<div>`), otherwise a `<span>`.
 */
export function MotionFrames({
  moving,
  still,
  block = false,
}: {
  moving: ReactNode;
  still: ReactNode;
  block?: boolean;
}) {
  const Wrapper = block ? 'div' : 'span';
  return (
    <>
      <Wrapper data-motion="moving">{moving}</Wrapper>
      <Wrapper data-motion="still">{still}</Wrapper>
    </>
  );
}
