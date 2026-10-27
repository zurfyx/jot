import type { Locator, Page } from '@playwright/test';

import {
  GERARD,
  chrome,
  dock,
  editor,
  expect,
  freshNoteId,
  openMore,
  openNote,
  pageFor,
  rest,
  settle,
  test,
} from './setup';

/**
 * Motion, frame by frame. Each trigger records the animations it starts
 * (what moves, for how long, with which easing and delay, how often), and
 * screenshots chosen frames with every animation paused at the same moment.
 * Animation names are left out: they are an implementation detail. Under
 * reduced motion, the same triggers start nothing.
 *
 * Motion doesn't depend on the theme or the width, so this runs once, in
 * the light 1440 project.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'visual-light-1440', 'Motion runs in one project.');
});

/**
 * From now on, pauses each animation as it starts, so a slow machine can't
 * let a short one end before it is read. `freeze` then seeks them all.
 */
function holdNewAnimations(page: Page): Promise<void> {
  return page.evaluate(() => {
    const hold = () => {
      for (const animation of document.getAnimations()) {
        if (animation.playState === 'running') {
          animation.pause();
        }
      }
    };
    for (const type of ['animationstart', 'transitionrun', 'transitionstart']) {
      document.addEventListener(type, hold, true);
    }
    hold();
  });
}

interface Motion {
  kind: string;
  target: string;
  property: string;
  duration: number | string;
  delay: number;
  easing: string;
  keyframeEasing: string;
  iterations: number | string;
  direction: string;
  fill: string;
}

/** Every running animation and transition, described without class names. */
function inventory(page: Page): Promise<Motion[]> {
  return page.evaluate(() => {
    // A path up to the nearest named or landmark ancestor, so wrappers
    // further up (providers, layout divs) never change a description.
    const LANDMARKS = ['MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'SECTION', 'DIALOG', 'BODY'];
    const describe = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node !== null) {
        const testid = node.getAttribute('data-testid');
        const role = node.getAttribute('role');
        const label =
          node.getAttribute('aria-label') ??
          document.getElementById(node.getAttribute('aria-labelledby') ?? '')?.textContent ??
          null;
        const tag = node.tagName.toLowerCase();
        if (testid !== null) {
          parts.unshift(`[${testid}]`);
          break;
        }
        if (label !== null) {
          parts.unshift(`${role ?? tag} "${label.trim()}"`);
          break;
        }
        if (tag === 'button' || tag === 'a') {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
          parts.unshift(`${tag} "${text}"`);
          break;
        }
        parts.unshift(tag);
        if (LANDMARKS.includes(node.tagName)) {
          break;
        }
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    return document
      .getAnimations()
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect;
        const timing = effect.getTiming();
        const target = effect.target;
        const pseudo = effect.pseudoElement ?? '';
        return {
          kind: animation.constructor.name,
          target: (target ? describe(target) : '(none)') + pseudo,
          property:
            animation instanceof CSSTransition
              ? animation.transitionProperty
              : Object.keys(effect.getKeyframes()[0] ?? {})
                  .filter(
                    (key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
                  )
                  .sort()
                  .join(' '),
          duration: typeof timing.duration === 'number' ? timing.duration : String(timing.duration),
          delay: timing.delay ?? 0,
          easing: timing.easing ?? 'linear',
          // A CSS animation's timing function lives on its keyframes.
          keyframeEasing: [...new Set(effect.getKeyframes().map((k) => k.easing ?? 'linear'))].join(
            ' | ',
          ),
          iterations: timing.iterations === Infinity ? 'infinite' : (timing.iterations ?? 1),
          direction: timing.direction ?? 'normal',
          fill: timing.fill ?? 'auto',
        };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  });
}

/** Pauses every animation `ms` into its own timeline (`fraction` of its duration if given). */
function freeze(page: Page, at: { ms?: number; fraction?: number }): Promise<void> {
  return page.evaluate(({ ms, fraction }) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      const duration = Number(animation.effect?.getTiming().duration ?? 0);
      const delay = Number(animation.effect?.getTiming().delay ?? 0);
      animation.currentTime = fraction !== undefined ? delay + duration * fraction : (ms ?? 0);
    }
  }, at);
}

/**
 * A frame mid-motion. Text rasterised mid-transform varies by a few pixels
 * between runs, so frames allow a little more than still shots: a frame that
 * moved or faded differently still fails.
 */
const FRAME = {
  animations: 'allow',
  threshold: 0.2,
  maxDiffPixelRatio: 0.003,
  // Lifts the still shots' pixel count (both limits apply); the ratio rules.
  maxDiffPixels: Number.MAX_SAFE_INTEGER,
} as const;

async function frame(target: Page | Locator, name: string): Promise<void> {
  await expect(target).toHaveScreenshot(`${name}.png`, FRAME);
}

async function expectMotion(page: Page, name: string): Promise<void> {
  const motions = await inventory(page);
  expect(motions.length, `${name} starts something`).toBeGreaterThan(0);
  expect(`${JSON.stringify(motions, null, 2)}\n`).toMatchSnapshot(`${name}.json`);
}

test('the landing page as it loads', async ({ page }) => {
  await page.clock.install();
  // Every animation starts paused, so a slow machine reads the same moment:
  // otherwise the feature tabs' 3-second progress line can end and move on
  // to the next tab before the inventory is taken. `freeze` seeks them.
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
    document.documentElement.append(style);
  });
  await page.goto('/');
  await settle(page);
  await rest(page);
  await expectMotion(page, 'motion-landing-load');
  // The headline's underline wipes in once. (The fan's loops are in the
  // inventory; the fan resumes them whenever it scrolls back into view, so
  // it is left out of these frames.)
  const box = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  // The underline hangs below the heading's box.
  const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 48 };
  for (const ms of [0, 700, 1100, 1600]) {
    await freeze(page, { ms });
    await expect(page).toHaveScreenshot(`motion-landing-load-${ms}.png`, { ...FRAME, clip });
  }
});

test('the fan, hovered and lifted', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await settle(page);
  // The load animations end first, and the fan's sway stops at its start.
  await page.evaluate(() =>
    document.getAnimations().forEach((animation) => {
      if (animation.effect?.getTiming().iterations === Infinity) {
        animation.cancel();
      } else {
        animation.finish();
      }
    }),
  );
  const card = page.getByTestId('new-note-card');
  const box = (await card.boundingBox())!;
  await holdNewAnimations(page);
  await page.mouse.move(box.x + 40, box.y + 40);
  const transitions = (await inventory(page)).filter(({ kind }) => kind === 'CSSTransition');
  expect(transitions.length).toBeGreaterThan(0);
  expect(`${JSON.stringify(transitions, null, 2)}\n`).toMatchSnapshot('motion-fan-lift.json');
  await page.evaluate(() =>
    document.getAnimations().forEach((animation) => {
      if (!(animation instanceof CSSTransition)) {
        animation.cancel();
      }
    }),
  );
  await freeze(page, { fraction: 0.5 });
  await frame(page.getByRole('region', { name: 'Just start typing.' }), 'motion-fan-lift-half');
});

test('a dock menu opening', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await settle(page);
  await holdNewAnimations(page);
  await dock(page).getByRole('button', { name: 'More' }).click();
  await expectMotion(page, 'motion-menu-open');
  await freeze(page, { fraction: 0.5 });
  await frame(page, 'motion-menu-open-half');
});

test('the status pill changing its state', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await settle(page);
  await holdNewAnimations(page);
  await page.getByTestId('status-pill').click();
  await expectMotion(page, 'motion-pill-change');
  await freeze(page, { fraction: 0.5 });
  await frame(chrome(page), 'motion-pill-change-half');
});

test('Share confirming a copy', async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await settle(page);
  await holdNewAnimations(page);
  await chrome(page).getByRole('button', { name: 'Share' }).click();
  await expect(chrome(page).getByRole('button', { name: 'Link copied' })).toBeVisible();
  await expectMotion(page, 'motion-share-copied');
  await freeze(page, { fraction: 0.5 });
  await frame(chrome(page), 'motion-share-copied-half');
});

test("blame's legend opening", async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Written by me');
  const more = await openMore(page);
  await more.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('blame-name')).toHaveText(['You']);
  await settle(page);
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
  await holdNewAnimations(page);
  await page.getByTestId('blame-chip').click();
  await expectMotion(page, 'motion-blame-legend');
  await freeze(page, { fraction: 0.5 });
  await frame(page, 'motion-blame-legend-half');
});

test('opening a note from the landing page, half way', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await page.addInitScript(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const transition = start(update);
      transition.ready.then(
        () => {
          for (const animation of document.getAnimations()) {
            animation.pause();
          }
          document.documentElement.dataset.vt = 'held';
        },
        () => undefined,
      );
      return transition;
    };
  });
  await page.goto('/');
  await settle(page);
  await page
    .getByRole('button', { name: /^Start a new note/ })
    .first()
    .click();
  await expect(page.locator('html[data-vt="held"]')).toBeAttached({ timeout: 15_000 });
  const motions = (await inventory(page)).filter(({ target }) => target.includes('::view-'));
  expect(`${JSON.stringify(motions, null, 2)}\n`).toMatchSnapshot('motion-view-transition.json');
  await freeze(page, { ms: 225 });
  await frame(page, 'motion-view-transition-half');
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
});

test('under reduced motion, nothing on a note page moves', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Written by me');
  const count = () => page.evaluate(() => document.getAnimations().length);
  await openMore(page);
  expect(await count()).toBe(0);
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('blame-chip').click();
  expect(await count()).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('status-pill').click();
  expect(await count()).toBe(0);
  await dock(page).getByRole('button', { name: 'Format' }).click();
  expect(await count()).toBe(0);
});
