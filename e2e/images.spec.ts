import { deflateSync, crc32 } from 'node:zlib';

import type { Page, Request } from '@playwright/test';

import { editor, expect, freshNoteId, openNote, test } from './helpers';
import { writeRawNote } from './raw-client';

/** A solid-colour PNG, built here so the tests need no fixture files. */
function png(width: number, height: number, rgb: [number, number, number] = [200, 40, 40]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row.set(rgb, 1 + x * 3);
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const IMAGE_SRC = /^\/api\/n\/[A-Za-z0-9_-]{22}\/images\/[A-Za-z0-9_-]{22}$/;

function images(page: Page) {
  return editor(page).getByTestId('image');
}

async function openImagePicker(page: Page) {
  await editor(page).click();
  await page.getByTestId('dock').getByRole('button', { name: 'Format' }).click();
  return page.getByRole('menuitem', { name: 'Image' });
}

async function pickImage(page: Page, name: string, buffer: Buffer) {
  const item = await openImagePicker(page);
  const chooser = page.waitForEvent('filechooser');
  await item.click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
}

/**
 * Pastes or drops an image the page draws itself (a canvas of `width` by
 * `height`), the way a browser hands a copied screenshot to the editor.
 */
async function sendCanvasImage(
  page: Page,
  how: 'paste' | 'drop',
  width: number,
  height: number,
  name = 'screenshot.png',
) {
  await editor(page).click();
  await page.evaluate(
    async ({ how, width, height, name }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#233f8f');
      gradient.addColorStop(1, '#c2410c');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type: 'image/png' }));
      const target = document.querySelector('[data-testid="editor"]')!;
      if (how === 'paste') {
        target.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      } else {
        const box = target.getBoundingClientRect();
        const point = { clientX: box.left + 20, clientY: box.top + 10 };
        target.dispatchEvent(
          new DragEvent('dragover', {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
            ...point,
          }),
        );
        target.dispatchEvent(
          new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, ...point }),
        );
      }
    },
    { how, width, height, name },
  );
}

test('Aa → Image uploads a picked file, and a second browser sees it', async ({
  page,
  otherContext,
}) => {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Before the picture');

  await pickImage(page, 'red-square.png', png(40, 30));
  const image = images(page).locator('img');
  await expect(images(page)).toHaveAttribute('data-state', 'ready');
  await expect(image).toHaveAttribute('src', IMAGE_SRC);
  await expect(image).toHaveAttribute('alt', 'Red square');
  await expect(image).toHaveAttribute('loading', 'lazy');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
  const src = (await image.getAttribute('src'))!;
  expect(src).toContain(`/api/n/${id}/images/`);

  const other = await otherContext.newPage();
  await openNote(other, id);
  const otherImage = images(other).locator('img');
  await expect(otherImage).toHaveAttribute('src', src);
  await expect(otherImage).toHaveAttribute('alt', 'Red square');
  await expect
    .poll(() => otherImage.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(40);
  await expect(editor(other)).toContainText('Before the picture');

  // It survives a reload, served by the Worker with its headers.
  const response = await page.request.get(src);
  expect(response.headers()['content-type']).toMatch(/^image\/(png|webp)$/);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  await page.reload();
  await expect(images(page).locator('img')).toHaveAttribute('src', src);
});

test('a pasted screenshot is shrunk to 1600 px as WebP before upload', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  const uploads: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/images')) {
      uploads.push(request);
    }
  });

  await sendCanvasImage(page, 'paste', 3000, 2000);
  const image = images(page).locator('img');
  await expect(images(page)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1600);
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(1067);
  await expect(image).toHaveAttribute('alt', 'Screenshot');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.headers()['content-type']).toBe('image/webp');
});

test('a dropped image is added where it is dropped', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await editor(page).click();
  await page.keyboard.type('Drop zone');
  await sendCanvasImage(page, 'drop', 120, 80, 'diagram.png');
  await expect(images(page)).toHaveAttribute('data-state', 'ready');
  await expect(images(page).locator('img')).toHaveAttribute('alt', 'Diagram');
  await expect(editor(page)).toContainText('Drop zone');
});

test('an upload shows a placeholder with its progress, then the image', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/images', async (route) => {
    await held;
    await route.continue();
  });

  await pickImage(page, 'slow.png', png(64, 48));
  const placeholder = images(page);
  await expect(placeholder).toHaveAttribute('data-state', 'uploading');
  await expect(placeholder.getByRole('progressbar', { name: 'Uploading Slow' })).toBeVisible();
  await expect(placeholder).toContainText('Uploading…');

  release();
  await expect(placeholder).toHaveAttribute('data-state', 'ready');
  await expect(placeholder.getByRole('progressbar')).toHaveCount(0);
});

test('a refused upload says why and removes its placeholder', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await page.route('**/images', (route) =>
    route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"too-many"}' }),
  );
  await pickImage(page, 'one-too-many.png', png(10, 10));
  await expect(page.getByTestId('image-notice')).toContainText(
    'Couldn’t add one-too-many.png: a note holds at most 20 images.',
  );
  await expect(images(page)).toHaveCount(0);
  await page.getByTestId('image-notice').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('image-notice')).toHaveCount(0);
});

test('a file that is not an image is refused with a message', async ({ page }) => {
  const id = freshNoteId();
  await openNote(page, id);
  const item = await openImagePicker(page);
  const chooser = page.waitForEvent('filechooser');
  await item.click();
  await (
    await chooser
  ).setFiles({
    name: 'drawing.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByTestId('image-notice')).toContainText(
    'only PNG, JPEG, WebP and GIF images can be added',
  );
  await expect(images(page)).toHaveCount(0);
});

test('images need a connection: Work offline disables Image and refuses a paste', async ({
  page,
}) => {
  const id = freshNoteId();
  await openNote(page, id);
  await page.getByTestId('dock').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work offline' }).click();
  await page.keyboard.press('Escape');

  const item = await openImagePicker(page);
  await expect(item).toBeDisabled();
  await expect(item).toContainText('Working offline');
  await expect(item).toHaveAttribute(
    'title',
    'Images need a connection. Turn off Work offline to add one.',
  );
  await page.keyboard.press('Escape');

  await sendCanvasImage(page, 'paste', 50, 50);
  await expect(page.getByTestId('image-notice')).toHaveText(
    /Images need a connection\. Turn off Work offline to add one\./,
  );
  await expect(images(page)).toHaveCount(0);
});

test('alt text is editable and reaches other people', async ({ page, otherContext }) => {
  const id = freshNoteId();
  await openNote(page, id);
  await pickImage(page, 'IMG_2041.png', png(30, 30));
  await expect(images(page)).toHaveAttribute('data-state', 'ready');

  await images(page).locator('img').click();
  const field = images(page).getByRole('textbox', { name: 'Alt text' });
  await expect(field).toHaveValue('IMG 2041');
  await field.fill('A red square');
  // Backspace in the field edits the text, never deletes the selected image.
  await field.press('Backspace');
  await field.press('e');
  await field.press('Enter');
  await expect(images(page).locator('img')).toHaveAttribute('alt', 'A red square');

  const other = await otherContext.newPage();
  await openNote(other, id);
  await expect(images(other).locator('img')).toHaveAttribute('alt', 'A red square');

  // A selected image goes with Backspace, for everyone.
  await images(page).locator('img').click();
  await page.keyboard.press('Escape');
  await images(page).locator('img').click();
  await editor(page).press('Backspace');
  await expect(images(page)).toHaveCount(0);
  await expect(images(other)).toHaveCount(0);
});

interface YNodeLike {
  toArray(): unknown[];
  getAttr(key: string): unknown;
  setAttr(key: string, value: unknown): void;
}

function isYNode(value: unknown): value is YNodeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as YNodeLike).toArray === 'function' &&
    typeof (value as YNodeLike).getAttr === 'function'
  );
}

/** Every Y node under `type` with a `s:src` attribute: the stored image nodes. */
function imageNodes(type: YNodeLike): YNodeLike[] {
  const found: YNodeLike[] = [];
  for (const child of type.toArray()) {
    if (isYNode(child)) {
      if (child.getAttr('s:src') !== undefined) {
        found.push(child);
      }
      found.push(...imageNodes(child));
    }
  }
  return found;
}

test('an image whose path is not this note’s is never requested or shown', async ({
  page,
  baseURL,
}) => {
  const id = freshNoteId();
  await openNote(page, id);
  await pickImage(page, 'mine.png', png(20, 20));
  await expect(images(page)).toHaveAttribute('data-state', 'ready');
  // A peer writes straight to the document, past the editor's own checks.
  const elsewhere = `/api/n/${freshNoteId()}/images/${freshNoteId()}`;
  const foreign: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example') || request.url().includes(elsewhere)) {
      foreign.push(request.url());
    }
  });
  for (const src of ['https://evil.example/tracker.png', elsewhere]) {
    let rewrote = 0;
    await writeRawNote(baseURL!, id, (doc) => {
      for (const node of imageNodes(doc.get('lexical-y') as unknown as YNodeLike)) {
        node.setAttr('s:src', src);
        rewrote++;
      }
    });
    expect(rewrote).toBe(1);
    await expect(images(page)).toHaveAttribute('data-state', 'foreign');
    await expect(images(page)).toContainText('Image not shown: it isn’t stored with this note.');
    await expect(images(page).locator('img')).toHaveCount(0);
  }
  await page.reload();
  await expect(images(page)).toHaveAttribute('data-state', 'foreign');
  expect(foreign).toEqual([]);
});
