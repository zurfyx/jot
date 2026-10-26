import { type ReadonlySignal, signal } from '@lexical/extension';
import { $dfs, $insertNodeToNearestRoot } from '@lexical/utils';
import {
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  $setState,
  type BaseSelection,
} from 'lexical';

import { type ImageUploadError, NOTE_MAX_IMAGES } from '../../../shared/images';
import type { NoteSession } from '../session';
import { $createImageNode, $isImageNode, type ImageNode } from './ImageNode';
import { srcState, uploadState } from './states';
import { altFromFileName, PrepareError, type PrepareProblem, prepareImage } from './shrink';
import { UploadError, uploadImage } from './upload';

/** An upload this tab is running: its preview and progress, by upload id. */
export interface LocalUpload {
  previewUrl: string;
  /** 0 to 1. */
  progress: number;
}

/** A message about images under the note's text, until it is replaced or dismissed. */
export interface ImageNotice {
  id: number;
  text: string;
}

/** What a note page knows about its images beyond the document. */
export interface ImageHost {
  noteId: string;
  uploads: ReadonlySignal<ReadonlyMap<string, LocalUpload>>;
  notice: ReadonlySignal<ImageNotice | null>;
  dismissNotice(): void;
}

interface Host extends ImageHost {
  uploadsSignal: ReturnType<typeof signal<ReadonlyMap<string, LocalUpload>>>;
  noticeSignal: ReturnType<typeof signal<ImageNotice | null>>;
  noticeTimer: ReturnType<typeof setTimeout> | null;
}

const hosts = new WeakMap<NoteSession, Host>();

/** How long a notice stays. */
export const NOTICE_MS = 8000;

export function imageHost(session: NoteSession): ImageHost {
  return hostOf(session);
}

function hostOf(session: NoteSession): Host {
  let host = hosts.get(session);
  if (host === undefined) {
    const uploadsSignal = signal<ReadonlyMap<string, LocalUpload>>(new Map());
    const noticeSignal = signal<ImageNotice | null>(null);
    const created: Host = {
      noteId: session.noteId,
      uploads: uploadsSignal,
      notice: noticeSignal,
      uploadsSignal,
      noticeSignal,
      noticeTimer: null,
      dismissNotice() {
        if (created.noticeTimer !== null) {
          clearTimeout(created.noticeTimer);
          created.noticeTimer = null;
        }
        noticeSignal.value = null;
      },
    };
    host = created;
    hosts.set(session, host);
  }
  return host;
}

let noticeIds = 0;

function say(host: Host, text: string): void {
  if (host.noticeTimer !== null) {
    clearTimeout(host.noticeTimer);
  }
  host.noticeSignal.value = { id: ++noticeIds, text };
  host.noticeTimer = setTimeout(() => {
    host.noticeTimer = null;
    host.noticeSignal.value = null;
  }, NOTICE_MS);
}

/** Why images can't be added to the note right now, or null when they can. */
export function imageBlockReason(session: NoteSession): string | null {
  if (session.cap.peek() === 'full') {
    return 'This note is full, so no images can be added.';
  }
  if (session.status.peek() !== 'active' || !session.editor.isEditable()) {
    return 'This note is read only, so no images can be added.';
  }
  if (session.workOffline.peek()) {
    return 'Images need a connection. Turn off Work offline to add one.';
  }
  if (session.connection.peek() !== 'connected') {
    return 'Images need a connection. Try again when jot is back online.';
  }
  return null;
}

/** What the page says when one image can't be added. */
export function imageProblemText(
  name: string,
  problem: PrepareProblem | ImageUploadError | 'network' | 'not-image',
): string {
  const file = name.trim() === '' ? 'the image' : name;
  switch (problem) {
    case 'not-image':
    case 'type':
      return `Couldn’t add ${file}: only PNG, JPEG, WebP and GIF images can be added.`;
    case 'unreadable':
      return `Couldn’t add ${file}: it couldn’t be read as an image.`;
    case 'too-large':
      return `Couldn’t add ${file}: it’s over 1.5 MB even after shrinking.`;
    case 'animated-too-large':
      return `Couldn’t add ${file}: animated GIFs must be under 1.5 MB.`;
    case 'too-many':
      return `Couldn’t add ${file}: a note holds at most ${NOTE_MAX_IMAGES} images.`;
    case 'no-room':
      return `Couldn’t add ${file}: this note’s images are at their 10 MB limit.`;
    case 'note-full':
      return `Couldn’t add ${file}: this note is full.`;
    case 'network':
      return `Couldn’t upload ${file}. Check the connection and try again.`;
  }
}

/** Whether a file looks like an image the browser may decode (SVG is never accepted). */
export function isCandidateImage(file: { type: string }): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

function newUploadId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

function $findUpload(uploadId: string): ImageNode | null {
  for (const { node } of $dfs($getRoot())) {
    if ($isImageNode(node) && node.data().upload === uploadId) {
      return node;
    }
  }
  return null;
}

function $insertImage(node: ImageNode, fallback: BaseSelection | null): void {
  let selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isNodeSelection(selection) && fallback !== null) {
    $setSelection(fallback.clone());
    selection = $getSelection();
  }
  if ($isNodeSelection(selection)) {
    const last = selection.getNodes().at(-1);
    if (last !== undefined) {
      last.getTopLevelElementOrThrow().insertAfter(node);
      node.selectNext();
      return;
    }
  }
  if ($isRangeSelection(selection)) {
    $insertNodeToNearestRoot(node);
    return;
  }
  $getRoot().append(node);
}

/**
 * Adds image files to the note at the selection (or `fallback`, a selection
 * saved before focus moved away): each is shrunk, shown as a placeholder
 * with its progress, uploaded, and then becomes the image. A failure says
 * why and removes its placeholder.
 */
export async function insertImageFiles(
  session: NoteSession,
  files: readonly File[],
  fallback: BaseSelection | null = null,
): Promise<void> {
  const host = hostOf(session);
  const blocked = imageBlockReason(session);
  if (blocked !== null) {
    say(host, blocked);
    return;
  }
  const uploads: Promise<void>[] = [];
  for (const file of files) {
    if (!isCandidateImage(file)) {
      say(host, imageProblemText(file.name, 'not-image'));
      continue;
    }
    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (error) {
      say(
        host,
        imageProblemText(file.name, error instanceof PrepareError ? error.problem : 'unreadable'),
      );
      continue;
    }
    // The note may have turned read only or gone offline while shrinking.
    const blockedNow = imageBlockReason(session);
    if (blockedNow !== null) {
      say(host, blockedNow);
      return;
    }
    const uploadId = newUploadId();
    const previewUrl = URL.createObjectURL(prepared.blob);
    const setUpload = (upload: LocalUpload | null) => {
      const next = new Map(host.uploadsSignal.peek());
      if (upload === null) {
        next.delete(uploadId);
      } else {
        next.set(uploadId, upload);
      }
      host.uploadsSignal.value = next;
    };
    setUpload({ previewUrl, progress: 0 });
    session.editor.update(
      () => {
        $insertImage(
          $createImageNode({
            alt: altFromFileName(file.name),
            width: prepared.width,
            height: prepared.height,
            upload: uploadId,
            started: Date.now(),
          }),
          fallback,
        );
      },
      { discrete: true },
    );
    uploads.push(
      uploadImage(session.noteId, prepared.blob, prepared.type, (progress) =>
        setUpload({ previewUrl, progress }),
      ).then(
        ({ src }) => {
          session.editor.update(
            () => {
              const node = $findUpload(uploadId);
              if (node !== null) {
                $setState(node, srcState, src);
                $setState(node, uploadState, '');
              }
            },
            { discrete: true },
          );
          setUpload(null);
          URL.revokeObjectURL(previewUrl);
        },
        (error: unknown) => {
          session.editor.update(
            () => {
              $findUpload(uploadId)?.remove();
            },
            { discrete: true },
          );
          setUpload(null);
          URL.revokeObjectURL(previewUrl);
          say(
            host,
            imageProblemText(file.name, error instanceof UploadError ? error.reason : 'network'),
          );
        },
      ),
    );
  }
  await Promise.all(uploads);
}

/** Aa → Image: opens the file picker and adds what the person chooses. */
export function pickImageFiles(session: NoteSession, fallback: BaseSelection | null): void {
  const host = hostOf(session);
  const blocked = imageBlockReason(session);
  if (blocked !== null) {
    say(host, blocked);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.multiple = true;
  input.hidden = true;
  input.dataset.testid = 'image-picker';
  input.addEventListener(
    'change',
    () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length > 0) {
        void insertImageFiles(session, files, fallback);
      }
    },
    { once: true },
  );
  input.addEventListener('cancel', () => input.remove(), { once: true });
  document.body.append(input);
  input.click();
}
