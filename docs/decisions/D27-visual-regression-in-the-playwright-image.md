# D27: Screenshots of every screen guard the look, taken in the Playwright image

Status: `DECIDED`

## Context

jot's look (D07) was checked by hand: open the landing page and a note in light and dark at
1440 and 390 px, and look. The end-to-end specs check behaviour and a few computed styles,
not pixels, so a change to the styles, a dependency bump or a move to another way of writing
CSS could change how jot looks without failing anything.

## Decision

- **A visual suite** (`e2e/visual/`) compares Playwright screenshots (`toHaveScreenshot`)
  against baselines stored in the repo, for every screen and state: the landing page's
  sections, hovers and feature tabs; a note empty and full of every block and format, the
  dock, its menus and panels, each state of the status pill, Share, remote carets, blame,
  the example, Ask AI's panels, every docs page and the inspector, and the edges (a full
  note, a read-only note, a malformed link).
- **Four projects**: light and dark, at 1440x900 and 390x844. Each test runs once per
  project, from a fresh page; nothing is resized or re-themed in place.
- **Motion has its own spec**, in one project: each trigger records the animations it
  starts (target, property, duration, delay, easing, iterations; never animation names)
  as a JSON baseline, and screenshots frames with every animation paused at the same
  moment. Under reduced motion, the same triggers start nothing.
- **Baselines come from the Playwright image** the `e2e` CI job runs in, on x86-64.
  `scripts/e2e-docker.sh` runs that image locally (emulated on Apple silicon), so a
  baseline taken on a laptop matches CI's pixels. Outside the image (`pnpm e2e` on a
  laptop) the visual projects are left out, because fonts and antialiasing differ.
- **Determinism over masking.** The clock is fixed, each person's name and colour are
  stored before the page loads, and Yjs client ids keep their randomness but get a fixed
  magnitude and an order by person, so sizes and the order of avatars never change. The
  status pill is shot only once its size has settled. Only the refused paste behind a full
  note's banner is masked.
- **Tolerance**: a per-pixel colour threshold of 0.1 and at most 40 differing pixels per
  still shot; mid-motion frames allow 0.3%, because text rasterised mid-transform varies.

## Why

- A screenshot catches what a behaviour test can't: spacing, colour, stacking, a missing
  focus ring, a menu that moved.
- One image for CI and laptops avoids per-platform baselines, which double the files and
  still drift. Emulating x86-64 is slower on a laptop, but baselines are rare and the same
  bytes as CI's are worth it.
- Fixing what varies keeps every shot honest; a mask hides the very thing it covers.
- Recording motion as data (durations, easings, delays) makes a change to it a readable
  diff, and the frames catch keyframes that changed while their timing didn't.

## Consequences

- An intended change to the look updates baselines in the same PR, through
  `pnpm e2e:docker --update-snapshots` (docs/testing.md). Reviewers see the PNGs change.
- The `e2e` job runs the visual projects too, so it takes longer.
- The suite reads Yjs's client-id draw (`random.uint53`, eight 32-bit words): a Yjs change
  there would make ids random again, and sizes could then differ by a byte. The suite
  would show it as a size diff.
