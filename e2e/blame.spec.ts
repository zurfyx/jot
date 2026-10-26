import { type BrowserContext, type Page } from '@playwright/test';

import { PEOPLE_ROOT } from '../src/shared/protocol';
import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { writeRawNote } from './raw-client';

/** A person: their name and colour, kept in their browser before the page loads. */
async function as(context: BrowserContext, name: string, color: number): Promise<Page> {
  await context.addInitScript(
    ([n, c]) => {
      localStorage.setItem('jot:name', n);
      localStorage.setItem('jot:color', c);
    },
    [name, String(color)] as const,
  );
  return context.newPage();
}

async function toggleBlame(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await page.keyboard.press('Escape');
}

/** The text under each blame highlight, by highlight name. */
function highlightedText(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...CSS.highlights.entries()]
        .filter(([name]) => name.startsWith('jot-blame-'))
        .map(([name, highlight]) => [
          name,
          [...highlight]
            .map((range) => {
              // Blame paints StaticRanges; read each one through a live Range.
              if (!(range instanceof StaticRange)) {
                return `not static: ${String(range)}`;
              }
              const live = new Range();
              live.setStart(range.startContainer, range.startOffset);
              live.setEnd(range.endContainer, range.endOffset);
              return live.toString();
            })
            .join('|'),
        ]),
    ),
  );
}

const GERARD = 'Plan for Thursday';
const ANA = 'Ana adds a much longer line of her own here';

test('blame shows who wrote what, from two people', async ({ context, otherContext }) => {
  const id = freshNoteId();
  const gerard = await as(context, 'Gerard', 0);
  const ana = await as(otherContext, 'Ana', 1);
  await openNote(gerard, id);
  await openNote(ana, id);

  await editor(gerard).click();
  await gerard.keyboard.type(GERARD);
  await expect(editor(ana)).toContainText(GERARD);
  await editor(ana).click();
  await ana.keyboard.press('ControlOrMeta+End');
  await ana.keyboard.press('Enter');
  await ana.keyboard.type(ANA);
  await expect(editor(gerard)).toContainText(ANA);

  // Off by default: nothing painted.
  await expect(gerard.getByTestId('blame-chip')).toHaveCount(0);
  expect(await highlightedText(gerard)).toEqual({});

  await toggleBlame(gerard);
  const chip = gerard.getByTestId('blame-chip');
  await expect(chip).toBeVisible();

  // One highlight per person, over exactly what each typed.
  await expect
    .poll(() => highlightedText(gerard))
    .toEqual({
      'jot-blame-0': ANA,
      'jot-blame-1': GERARD,
    });

  // The margin names each author's run of lines.
  await expect(gerard.getByTestId('blame-name')).toHaveText(['You', 'Ana']);

  // The legend: shares in characters.
  await chip.click();
  const legend = gerard.getByTestId('blame-legend');
  await expect(legend.getByTestId('blame-person')).toHaveText([/^Ana\s*\d+%$/, /^You\s*\d+%$/]);
  const anaShare = Math.round((ANA.length / (ANA.length + GERARD.length)) * 100);
  await expect(legend.getByTestId('blame-share')).toHaveText([
    `${anaShare}%`,
    `${100 - anaShare}%`,
  ]);

  // Clicking a name focuses that person.
  const anaRow = legend.getByTestId('blame-person').first();
  await anaRow.click();
  await expect(anaRow).toHaveAttribute('aria-checked', 'true');
  await expect(gerard.locator('.blame-run.is-faded')).toHaveCount(1);
  await anaRow.click();
  await expect(gerard.locator('.blame-run.is-faded')).toHaveCount(0);

  // Ana's window sees the same people, with herself as "You".
  await toggleBlame(ana);
  await expect(ana.getByTestId('blame-name')).toHaveText(['Gerard', 'You']);

  // Hide blame clears everything.
  await legend.getByRole('menuitem', { name: 'Hide blame' }).click();
  await expect(chip).toHaveCount(0);
  await expect(gerard.getByTestId('blame-margin')).toHaveCount(0);
  expect(await highlightedText(gerard)).toEqual({});
});

test('hovering attributed text says who wrote it', async ({ context, otherContext }) => {
  const id = freshNoteId();
  const gerard = await as(context, 'Gerard', 0);
  const ana = await as(otherContext, 'Ana', 1);
  await openNote(gerard, id);
  await openNote(ana, id);
  await editor(ana).click();
  await ana.keyboard.type('Written by Ana');
  await expect(editor(gerard)).toContainText('Written by Ana');

  await toggleBlame(gerard);
  await expect(gerard.getByTestId('blame-name')).toHaveText(['Ana']);
  const box = await editor(gerard).getByText('Written by Ana').boundingBox();
  expect(box).not.toBeNull();
  await gerard.mouse.move(box!.x + 20, box!.y + box!.height / 2);
  const card = gerard.getByTestId('blame-card');
  await expect(card).toContainText('Ana');
  await expect(card).toContainText('wrote this · last active just now');

  // Away from the text, the card goes.
  await gerard.mouse.move(box!.x + 20, box!.y + 400);
  await expect(card).toHaveCount(0);
});

test('reconnecting from Work offline shows blame for a few seconds', async ({ page }) => {
  await openNote(page, freshNoteId());
  await editor(page).click();
  await page.keyboard.type('Before');
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.type(' and offline');

  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('status-pill')).toHaveText('Back online · merged');
  await expect(page.getByTestId('blame-chip')).toBeVisible();
  await expect(page.getByTestId('blame-name')).toHaveText(['You']);
  // It was off, so it goes again, and Show blame stays off.
  await expect(page.getByTestId('blame-chip')).toHaveCount(0, { timeout: 8000 });
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show blame' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('the registry holds one entry per writing client, and none for readers', async ({
  context,
  otherContext,
  baseURL,
}) => {
  const id = freshNoteId();
  const writer = await as(context, 'Gerard', 0);
  const reader = await as(otherContext, 'Ana', 1);
  await openNote(writer, id);
  await editor(writer).click();
  await writer.keyboard.type('Only Gerard writes');
  await openNote(reader, id);
  await expect(editor(reader)).toContainText('Only Gerard writes');
  await editor(reader).click();
  await toggleBlame(reader);
  await reader.getByTestId('blame-chip').click();
  await expect(reader.getByTestId('blame-person')).toHaveText([/^Gerard\s*100%$/]);
  await reader.waitForTimeout(500);

  let entries: unknown[] = [];
  await writeRawNote(baseURL!, id, (doc) => {
    entries = Object.values(doc.get(PEOPLE_ROOT).getAttrs());
  });
  expect(entries).toEqual([
    { p: expect.any(String), n: 'Gerard', c: 0, k: 'person', s: expect.any(Number) },
  ]);
});
