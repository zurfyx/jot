import type { BrowserContext, Locator, Page, PageScreenshotOptions } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from '../helpers';

export { editor, expect, freshNoteId, openNote, test };

/**
 * The visual suite: screenshots of every screen and state, compared against
 * stored baselines (docs/testing.md says how to update them on purpose). It
 * runs as four projects, light and dark at 1440x900 and 390x844, in the
 * Playwright image CI uses, so fonts and rendering match everywhere.
 *
 * What would differ between two runs is made deterministic, not masked:
 *
 * - the time is fixed (a note page's "kept until" date, "editing", "last
 *   active just now" and the remote carets' name labels all read the clock);
 * - each person's name and colour are stored before the page loads;
 * - Yjs client ids keep their randomness but get a fixed magnitude and an
 *   order by person, so a note's encoded size and the order of avatars and
 *   blame rows never change between runs.
 */

/** Every note page reads this time. A Thursday, mid-morning in Europe. */
export const FIXED_TIME = new Date('2026-10-01T10:00:00Z');

export interface Person {
  name: string;
  color: number;
  /** Orders this person's Yjs client ids after those of lower ranks (1 to 15). */
  rank: number;
}

export const GERARD: Person = { name: 'Gerard', color: 0, rank: 1 };
export const ANA: Person = { name: 'Ana', color: 1, rank: 2 };

/**
 * Makes `context` this person: their name and colour in localStorage, the
 * clock fixed, and Yjs client ids that sort by rank. `@y/y` draws a client id
 * as `(a & 0x1fffff) * 2^32 + b` from a `Uint32Array(8)`, and nothing else in
 * jot asks for eight 32-bit words at once, so only client ids change: bit 20
 * is always set (every id encodes to the same number of bytes), then the
 * rank, then a per-page counter, then random bits that keep ids unique.
 */
export async function asPerson(context: BrowserContext, person: Person): Promise<void> {
  await context.clock.setFixedTime(FIXED_TIME);
  await context.addInitScript(({ name, color, rank }: Person) => {
    try {
      localStorage.setItem('jot:name', name);
      localStorage.setItem('jot:color', String(color));
    } catch {
      // Pages without storage (about:blank) need no person.
    }
    const original = Crypto.prototype.getRandomValues;
    let counter = 0;
    Crypto.prototype.getRandomValues = function <T extends ArrayBufferView | null>(array: T): T {
      const result = original.call(this, array as never) as T;
      if (array instanceof Uint32Array && array.length === 8) {
        counter = (counter + 1) & 0xff;
        array[0] = 0x100000 | (rank << 16) | (counter << 8) | (array[0]! & 0xff);
      }
      return result;
    };
  }, person);
}

/** A page for `person` in `context`. */
export async function pageFor(context: BrowserContext, person: Person): Promise<Page> {
  await asPerson(context, person);
  return context.newPage();
}

/**
 * The status pill's size settles a few seconds after the last edit: the page
 * measures a second after it, and the relay reports what it stored after its
 * save (two seconds). Waits until the pill has read the same for three seconds.
 */
async function steadyPill(page: Page): Promise<void> {
  const pill = page.getByTestId('status-pill');
  if ((await pill.count()) === 0) {
    return;
  }
  let last = await pill.innerText();
  let steadyFor = 0;
  for (let waited = 0; steadyFor < 3000; waited += 500) {
    if (waited >= 20_000) {
      throw new Error(`The status pill never settled in 20 s; it last read "${last}".`);
    }
    await page.waitForTimeout(500);
    const now = await pill.innerText();
    steadyFor = now === last ? steadyFor + 500 : 0;
    last = now;
  }
}

/**
 * Holds the page's timers where they are (Playwright's clock, paused), so a
 * state that a timer ends, such as Share's 1.8 s "Link copied", stays for a
 * capture. Settle first: `settle` waits on animation frames, which a paused
 * clock holds too. `page.clock.runFor` lets the held timers run.
 */
export async function holdTimers(page: Page): Promise<void> {
  await page.clock.pauseAt(new Date(FIXED_TIME.getTime() + 1000));
}

/**
 * Waits for the web fonts, a steady status pill and two frames, so text is
 * laid out in Geist and nothing is about to change.
 */
export async function settle(page: Page): Promise<void> {
  await steadyPill(page);
  await page.evaluate(async () => {
    // Load both families outright: `fonts.ready` resolves at once when the
    // browser hasn't started a load yet, as for text rendered a moment ago.
    await Promise.all([
      document.fonts.load('16px "Geist Variable"'),
      document.fonts.load('16px "Geist Mono Variable"'),
    ]);
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

type ShotOptions = Pick<PageScreenshotOptions, 'fullPage' | 'mask' | 'clip'>;

/** Compares the page (the viewport, unless `fullPage`) against `<name>.png`. */
export async function shoot(page: Page, name: string, options: ShotOptions = {}): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, options);
}

/**
 * Compares the whole page against `<name>.png` by growing the viewport to the
 * page's height first. Playwright's own full-page capture measures the page
 * and then grows the viewport; on the docs, whose nav is `100vh` tall, that
 * changes the height it measured and two captures never agree.
 */
export async function shootTall(page: Page, name: string): Promise<void> {
  await settle(page);
  const size = page.viewportSize()!;
  let height = size.height;
  for (let i = 0; i < 5; i++) {
    const next = await page.evaluate(() => document.documentElement.scrollHeight);
    if (next === height) {
      break;
    }
    height = next;
    await page.setViewportSize({ width: size.width, height });
  }
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
  await page.setViewportSize(size);
}

/** Compares one element against `<name>.png`. */
export async function shootElement(target: Locator, name: string): Promise<void> {
  await settle(target.page());
  await expect(target).toHaveScreenshot(`${name}.png`);
}

/** Whether this run is the phone-sized project. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 600;
}

/** Sets a Lexical editor state from its JSON (the node shapes in `content.ts`). */
export async function setNoteContent(page: Page, root: unknown): Promise<void> {
  await page.evaluate((root) => {
    const element = document.querySelector('[data-testid="editor"]') as HTMLElement & {
      __lexicalEditor: {
        parseEditorState(json: string): unknown;
        setEditorState(state: unknown): void;
      };
    };
    const lexical = element.__lexicalEditor;
    lexical.setEditorState(lexical.parseEditorState(JSON.stringify({ root })));
  }, root);
}

/** The note page's top bar: avatars, status pill and Share. */
export function chrome(page: Page): Locator {
  return page.getByRole('banner');
}

export function dock(page: Page): Locator {
  return page.getByTestId('dock');
}

/** Opens ⋯ and returns its menu. */
export async function openMore(page: Page): Promise<Locator> {
  await dock(page).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  return menu;
}

/** Blur whatever has focus and park the pointer in a corner nothing reacts to. */
export async function rest(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
}
