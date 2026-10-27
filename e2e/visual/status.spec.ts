import type { Page } from '@playwright/test';

import { writeRawNote } from '../raw-client';
import { flakyLink, holdOutgoingContent } from '../sockets';
import {
  GERARD,
  chrome,
  editor,
  expect,
  freshNoteId,
  openNote,
  pageFor,
  rest,
  setNoteContent,
  shoot,
  shootElement,
  test,
} from './setup';

/** The status pill in each of its states, with the top bar around it. */

function pill(page: Page) {
  return page.getByTestId('status-pill');
}

/** Characters for a filler type the editor never shows (the note's size only). */
function filler(length: number): string {
  return 'x'.repeat(length);
}

test('Synced', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await rest(page);
  await shootElement(chrome(page), 'pill-synced');
});

test('Connecting', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  // The socket opens but the relay never answers.
  await page.routeWebSocket(/\/api\/n\//, () => {});
  await page.goto(`/n/${freshNoteId()}`);
  await expect(pill(page)).toHaveText('Connecting…');
  await rest(page);
  await shootElement(chrome(page), 'pill-connecting');
});

test('Offline, with edits waiting', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  await openNote(page, freshNoteId());
  await pill(page).click();
  await editor(page).click();
  // One insertion, one edit: the count in the pill is the same every run.
  await page.keyboard.insertText('Written offline');
  await expect(pill(page)).toHaveText('Offline · 1 edit waiting');
  await rest(page);
  await shootElement(chrome(page), 'pill-offline');
});

test('Syncing', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  const link = await holdOutgoingContent(page);
  await openNote(page, freshNoteId());
  await pill(page).click();
  await editor(page).click();
  await page.keyboard.type('Held back');
  // Reconnecting: the relay syncs the page, but the page's edits don't reach it yet.
  link.hold = true;
  await chrome(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(pill(page)).toHaveText(/^Syncing · \d+ edits? waiting$/);
  await rest(page);
  await shootElement(chrome(page), 'pill-syncing');
});

test('Back online', async ({ context }) => {
  const page = await pageFor(context, GERARD);
  const link = await flakyLink(page);
  await openNote(page, freshNoteId());
  link.drop();
  await editor(page).click();
  await page.keyboard.type('Written while the link was down');
  await expect(pill(page)).toHaveText(/^Offline · /);
  link.restore();
  await expect(pill(page)).toHaveText('Back online · merged', { timeout: 15_000 });
  await rest(page);
  await shootElement(chrome(page), 'pill-back-online');
});

test('near the cap: amber, with its notice', async ({ context, baseURL }) => {
  const id = freshNoteId();
  // Two writes, each under the relay's message size.
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(850_000)));
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(850_000)));
  const page = await pageFor(context, GERARD);
  await openNote(page, id);
  await expect(page.getByText('This note is almost full.')).toBeVisible();
  await rest(page);
  await shootElement(chrome(page), 'pill-near-cap');
  await shoot(page, 'note-near-cap');
});

test('full: red, with the full-note banner', async ({ context, baseURL }) => {
  test.setTimeout(60_000);
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(950_000)));
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(950_000)));
  await writeRawNote(baseURL!, id, (doc) => doc.get('filler').insert(0, filler(80_000)));
  const page = await pageFor(context, GERARD);
  await openNote(page, id);
  // A paste over what is left: the relay refuses it, and the note is full.
  await setNoteContent(page, {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [
      {
        type: 'paragraph',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            type: 'text',
            version: 1,
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'too much '.repeat(4_000),
          },
        ],
      },
    ],
  });
  await expect(pill(page)).toHaveText(/^Full · /, { timeout: 15_000 });
  await expect(page.getByText('This note is full.')).toBeVisible();
  await rest(page);
  await shootElement(chrome(page), 'pill-full');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'note-full', {
    // The refused paste stays on this page; its text is not the point here.
    mask: [editor(page)],
  });
});
