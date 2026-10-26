import {
  IMAGE_TYPES,
  type ImageType,
  type ImageUploadError,
  type ImageUploadResult,
  isImageKey,
  noteImagesPath,
  parseImagePath,
} from '../../../shared/images';

/** Why an upload failed: the server's reason, or the network. */
export class UploadError extends Error {
  constructor(readonly reason: ImageUploadError | 'network') {
    super(reason);
  }
}

const SERVER_REASONS: readonly string[] = ['type', 'too-large', 'too-many', 'no-room', 'note-full'];

/** The server's answer as a result, or the reason it refused (anything unexpected is 'network'). */
export function readUploadResponse(
  noteId: string,
  status: number,
  body: string,
): ImageUploadResult | UploadError {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // not JSON
  }
  const record = (json ?? {}) as Record<string, unknown>;
  if (status === 201) {
    const { key, src } = record;
    if (
      typeof key === 'string' &&
      typeof src === 'string' &&
      isImageKey(key) &&
      parseImagePath(src)?.noteId === noteId
    ) {
      return { key, src };
    }
    return new UploadError('network');
  }
  const error = record.error;
  if (typeof error === 'string' && SERVER_REASONS.includes(error)) {
    return new UploadError(error as ImageUploadError);
  }
  return new UploadError('network');
}

/**
 * Uploads one prepared image to note `noteId`, reporting progress from 0 to
 * 1. XMLHttpRequest rather than fetch: only it reports upload progress.
 */
export function uploadImage(
  noteId: string,
  blob: Blob,
  type: ImageType,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ImageUploadResult> {
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) {
    return Promise.reject(new UploadError('type'));
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', noteImagesPath(noteId));
    request.setRequestHeader('Content-Type', type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    request.onload = () => {
      const result = readUploadResponse(noteId, request.status, request.responseText);
      if (result instanceof UploadError) {
        reject(result);
      } else {
        onProgress(1);
        resolve(result);
      }
    };
    request.onerror = () => reject(new UploadError('network'));
    request.onabort = () => reject(new UploadError('network'));
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(blob);
  });
}
