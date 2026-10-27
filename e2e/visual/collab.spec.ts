import type { Page } from '@playwright/test';

import {
  ANA,
  GERARD,
  editor,
  expect,
  freshNoteId,
  openMore,
  openNote,
  pageFor,
  rest,
  shoot,
  test,
} from './setup';

/** Two people on one note: carets, blame, and the example's demo collaborators. */

async function twoPeople(gerard: Page, ana: Page) {
  const id = freshNoteId();
  await openNote(gerard, id);
  await openNote(ana, id);
  await editor(gerard).click();
  await gerard.keyboard.type('Plan for Thursday');
  await expect(editor(ana)).toContainText('Plan for Thursday');
  await editor(ana).click();
  await ana.keyboard.press('ControlOrMeta+End');
  await ana.keyboard.press('Enter');
  await ana.keyboard.type('Ana adds a much longer line of her own here');
  await expect(editor(gerard)).toContainText('of her own here');
}

test('the remote carets of two people', async ({ context, otherContext }) => {
  const gerard = await pageFor(context, GERARD);
  const ana = await pageFor(otherContext, ANA);
  await twoPeople(gerard, ana);
  // Ana selects her last word; Gerard sees her selection and her caret.
  await ana.keyboard.press('Shift+ControlOrMeta+ArrowLeft');
  await gerard.keyboard.press('ControlOrMeta+Home');
  await expect(gerard.getByTestId('remote-caret')).toHaveCount(1);
  await expect(ana.getByTestId('remote-caret')).toHaveCount(1);
  await rest(gerard);
  await shoot(gerard, 'collab-carets');
  await rest(ana);
  await shoot(ana, 'collab-carets-other');
});

test('blame: on, the legend, a focused author and the hover card', async ({
  context,
  otherContext,
}) => {
  const gerard = await pageFor(context, GERARD);
  const ana = await pageFor(otherContext, ANA);
  await twoPeople(gerard, ana);
  // Gerard's caret back on his own line, so Ana's caret sits apart from blame's margin.
  await gerard.keyboard.press('ControlOrMeta+Home');

  const more = await openMore(gerard);
  await more.getByRole('menuitemcheckbox', { name: 'Show blame' }).click();
  await gerard.keyboard.press('Escape');
  await expect(gerard.getByTestId('blame-name')).toHaveText(['You', 'Ana']);
  await rest(gerard);
  await shoot(gerard, 'blame-on');

  await gerard.getByTestId('blame-chip').click();
  const legend = gerard.getByTestId('blame-legend');
  await expect(legend.getByTestId('blame-person')).toHaveCount(2);
  await rest(gerard);
  await shoot(gerard, 'blame-legend');

  await legend.getByTestId('blame-person').first().click();
  await expect(legend.getByTestId('blame-person').first()).toHaveAttribute('aria-checked', 'true');
  await rest(gerard);
  await shoot(gerard, 'blame-focused');

  await gerard.keyboard.press('Escape');
  await expect(legend).toHaveCount(0);
  const box = await editor(gerard).getByText('of her own here').boundingBox();
  expect(box).not.toBeNull();
  await gerard.mouse.move(box!.x + 10, box!.y + box!.height / 2);
  await expect(gerard.getByTestId('blame-card')).toContainText('Ana');
  await shoot(gerard, 'blame-hover-card');
});

test('the example: its banner and the demo carets', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  // Under reduced motion the demo plays at once, to the same end.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new?example');
  await expect(page).toHaveURL(/\/n\/[\w-]{22}$/, { timeout: 15_000 });
  await expect(page.getByTestId('example-banner')).toBeVisible();
  await expect(editor(page)).toContainText('Snacks', { timeout: 10_000 });
  await expect(page.getByTestId('remote-caret')).toHaveCount(2);
  await rest(page);
  await shoot(page, 'example');
});
