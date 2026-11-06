import { type Page } from '@playwright/test';
import { seedYState } from '@lexical/y/headless';
import * as syncProtocol from '@y/protocols/sync';
import * as Y from '@y/y';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { jotNodesExtension } from '../src/shared/nodes';
import { MESSAGE_SYNC } from '../src/shared/protocol';
import { SCHEMA_VERSION } from '../src/shared/schema';
import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { readRawNote, writeRawNote } from './raw-client';

/**
 * The generation fence (D34) in the browser: a page holding edits made
 * against an earlier generation of its note hands them off and opens the
 * note afresh; the edits wait under ⋯ → Offline edits. A client from before
 * the fence is captured and turned read only on a note it may not join.
 */

async function workOffline(page: Page) {
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');
}

async function appendLine(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
}

/** Moves the note on, as a migration will: a new incarnation, every socket closed. */
async function replaceIncarnation(baseURL: string, id: string) {
  const response = await fetch(`${baseURL}/api/test/n/${id}/replace-incarnation`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  await response.text();
}

function noteText(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return JSON.stringify(doc.get('lexical-y').toJSON());
}

test('a page offline while its note moved on hands its edits off; they wait under Offline edits', async ({
  context,
  otherContext,
  baseURL,
}) => {
  const id = freshNoteId();
  const a = await context.newPage();
  const b = await context.newPage();
  await openNote(a, id);
  await openNote(b, id);
  await editor(a).click();
  await a.keyboard.type('Shared start');
  await expect(editor(b)).toContainText('Shared start');

  await workOffline(b);
  await appendLine(b, 'Written offline by B');
  await expect(b.getByTestId('status-pill')).toHaveText(/^Offline · \d+ edits? waiting$/);

  // A was online: it reconnects (stale: its document belongs to the earlier
  // generation), hands off nothing new, and opens the note afresh on a new socket.
  const sockets: string[] = [];
  a.on('websocket', (socket) => sockets.push(socket.url()));
  await replaceIncarnation(baseURL!, id);
  await expect.poll(() => sockets.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(a.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(editor(a)).toHaveAttribute('contenteditable', 'true');
  await appendLine(a, 'Written online by A');

  await b.getByRole('button', { name: 'Reconnect' }).click();
  // B's edits were made against the earlier generation: saved apart, never merged.
  await expect(b.getByTestId('recovery-banner')).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId('status-pill')).toContainText('Synced');
  await expect(editor(b)).toContainText('Written online by A');
  await expect(editor(b)).not.toContainText('Written offline by B');
  await expect(editor(a)).not.toContainText('Written offline by B');
  await expect
    .poll(async () => noteText(await readRawNote(baseURL!, id)))
    .not.toContain('Written offline by B');
  // A's own record holds nothing new: no banner there.
  await expect(a.getByTestId('recovery-banner')).toHaveCount(0);

  await b.getByTestId('recovery-banner').getByRole('button', { name: 'View' }).click();
  await expect(b.getByTestId('recovery-text')).toContainText('Written offline by B');
  await expect(b.getByTestId('recovery-text')).toContainText('Shared start');
  await expect(b.getByTestId('recovery-text')).toHaveAttribute('aria-readonly', 'true');

  // Everyone sees it under ⋯ → Offline edits; in another browser it is another visitor's.
  const c = await otherContext.newPage();
  await openNote(c, id);
  await expect(c.getByTestId('recovery-banner')).toHaveCount(0);
  await c.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await c.getByTestId('recovery-item').click();
  const rows = c.getByTestId('recovery-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Another visitor');
  await rows.first().getByRole('button', { name: 'View' }).click();
  await expect(c.getByTestId('recovery-text')).toContainText('Written offline by B');

  // Dismissed, the banner stays away on the next page.
  await b.getByTestId('recovery-banner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(b.getByTestId('recovery-banner')).toHaveCount(0);
  await b.reload();
  await expect(b.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await expect(b.getByTestId('recovery-banner')).toHaveCount(0);
});

test('a client from before the fence is captured on a new note: read only, its text kept, the note untouched', async ({
  page,
  baseURL,
}) => {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('The note today');
  await expect
    .poll(async () => noteText(await readRawNote(baseURL!, id)))
    .toContain('The note today');

  // An older jot's document: its own note, offline text included.
  const doc = new Y.Doc();
  Y.applyUpdate(
    doc,
    seedYState({ extensions: [jotNodesExtension], schemaVersion: SCHEMA_VERSION }, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('Kept by an older tab')));
    }),
  );
  // No handshake: the URL of a jot from before the fence.
  const socket = new WebSocket(`${baseURL!.replace(/^http/, 'ws')}/api/n/${id}/ws`);
  socket.binaryType = 'arraybuffer';
  const received: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error('socket error'));
    socket.onopen = () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      socket.send(encoding.toUint8Array(encoder));
    };
    socket.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) {
        return;
      }
      const peek = decoding.createDecoder(decoder.arr);
      peek.pos = decoder.pos;
      const subtype = decoding.readVarUint(peek);
      if (subtype !== syncProtocol.messageYjsSyncStep1) {
        received.push(decoding.readVarUint8Array(peek));
      }
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, doc, 'remote');
      if (encoding.length(reply) > 1) {
        socket.send(encoding.toUint8Array(reply));
      }
      if (subtype === syncProtocol.messageYjsSyncStep2) {
        resolve();
      }
    };
  });
  socket.close();
  // It got the signal (a schema record above jot's), then an empty step 2:
  // nothing of the note, and its own text is intact.
  expect(doc.get('lexical-y').getAttr(`lexical-y-schema:${SCHEMA_VERSION + 1}`)).toBe(true);
  expect(JSON.stringify(doc.get('lexical-y').toJSON())).toContain('Kept by an older tab');
  const scratch = new Y.Doc();
  for (const payload of received) {
    Y.applyUpdate(scratch, payload);
  }
  expect(JSON.stringify(scratch.get('lexical-y').toJSON())).not.toContain('The note today');
  expect(noteText(await readRawNote(baseURL!, id))).not.toContain('Kept by an older tab');

  // The page sees it under ⋯ → Offline edits, as another visitor's.
  await page.reload();
  await expect(page.getByTestId('status-pill')).toContainText('Synced', { timeout: 15_000 });
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByTestId('recovery-item').click();
  await page.getByTestId('recovery-row').first().getByRole('button', { name: 'View' }).click();
  await expect(page.getByTestId('recovery-text')).toContainText('Kept by an older tab');
});

test('a note this release cannot read reloads once, then says so', async ({ page, baseURL }) => {
  const id = freshNoteId();
  await writeRawNote(baseURL!, id, (doc) => {
    const root = doc.get('lexical-y');
    root.setAttr('lexical-y:99', true);
    root.insert(0, 'From the future');
  });
  let loads = 0;
  page.on('load', () => loads++);
  await page.goto(`/n/${id}`);
  await expect(page.getByText('This note was upgraded.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('status-pill')).toHaveText('Reload to edit');
  expect(loads).toBe(2);
  await expect(editor(page)).not.toContainText('From the future');
});
