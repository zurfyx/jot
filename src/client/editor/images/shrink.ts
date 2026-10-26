/**
 * Shrinking images in the browser before upload (D26): decode, scale to at
 * most IMAGE_MAX_EDGE pixels on the long side, encode WebP. jot never needs
 * Cloudflare's image transformations. GIFs under the size limit are kept as
 * they are (animation included); animated ones over it are refused.
 *
 * The decisions are pure functions (tested in Node); `prepareImage` runs
 * them against the browser's decoder and canvas.
 */

import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  type ImageType,
  isAnimatedGif,
  isImageType,
  sniffImageType,
} from '../../../shared/images';

/** Why a file can't be added, before anything is sent. */
export type PrepareProblem = 'unreadable' | 'too-large' | 'animated-too-large';

export class PrepareError extends Error {
  constructor(readonly problem: PrepareProblem) {
    super(problem);
  }
}

export interface PreparedImage {
  blob: Blob;
  type: ImageType;
  width: number;
  height: number;
}

/** The size that fits `max` on the long side, keeping the ratio; never scales up. */
export function scaledSize(
  width: number,
  height: number,
  max: number = IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) {
    return { width, height };
  }
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface OriginalInfo {
  /** The type its bytes say, or null for a type jot doesn't store (AVIF, BMP, HEIC…). */
  type: ImageType | null;
  size: number;
  width: number;
  height: number;
  /** For a GIF: more than one frame. */
  animated: boolean;
}

/**
 * What to do with a file before encoding anything: keep a GIF as it is
 * (small enough, so its animation survives), refuse an animated GIF that
 * is too big, or re-encode.
 */
export function planFor(original: OriginalInfo): 'keep' | 'encode' | PrepareProblem {
  if (original.type === 'image/gif') {
    if (original.size <= IMAGE_MAX_BYTES) {
      return 'keep';
    }
    if (original.animated) {
      return 'animated-too-large';
    }
  }
  return 'encode';
}

/**
 * Picks what to upload from the encodings tried, in order of preference:
 * the smallest encoding under the limit, or the original when it is a type
 * jot stores, already fits IMAGE_MAX_EDGE, and is smaller than every
 * encoding (a crisp small PNG stays a PNG).
 */
export function chooseUpload(
  original: OriginalInfo,
  encoded: readonly { type: ImageType; size: number }[],
): 'original' | number | 'too-large' {
  let best = -1;
  encoded.forEach((candidate, index) => {
    if (candidate.size <= IMAGE_MAX_BYTES && (best < 0 || candidate.size < encoded[best]!.size)) {
      best = index;
    }
  });
  const originalFits =
    original.type !== null &&
    original.size <= IMAGE_MAX_BYTES &&
    Math.max(original.width, original.height) <= IMAGE_MAX_EDGE;
  if (originalFits && (best < 0 || original.size <= encoded[best]!.size)) {
    return 'original';
  }
  return best < 0 ? 'too-large' : best;
}

/** The alt text an image gets from its file name: "Team photo" from "team-photo.jpg". */
export function altFromFileName(name: string): string {
  const base = name
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (base === '' || /^image$/i.test(base)) {
    return '';
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Qualities tried for WebP (or JPEG where the browser can't encode WebP), best first. */
export const QUALITIES = [0.85, 0.7, 0.5] as const;

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Decodes, scales and encodes a file for upload; throws PrepareError when it can't be added. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PrepareError('unreadable');
  }
  try {
    const original: OriginalInfo = {
      type: sniffed,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      animated: sniffed === 'image/gif' && isAnimatedGif(bytes),
    };
    const plan = planFor(original);
    if (plan === 'keep') {
      return { blob: file, type: 'image/gif', width: original.width, height: original.height };
    }
    if (plan !== 'encode') {
      throw new PrepareError(plan);
    }
    const size = scaledSize(original.width, original.height);
    const canvas = makeCanvas(size.width, size.height);
    const context = canvas.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (context === null) {
      throw new PrepareError('unreadable');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const encoded: PreparedImage[] = [];
    for (const quality of QUALITIES) {
      let blob = await encode(canvas, 'image/webp', quality);
      // Browsers that can't encode WebP hand back a PNG; try JPEG then.
      if (blob === null || blob.type !== 'image/webp') {
        blob = await encode(canvas, 'image/jpeg', quality);
      }
      if (blob !== null && isImageType(blob.type)) {
        encoded.push({ blob, type: blob.type, ...size });
        if (blob.size <= IMAGE_MAX_BYTES) {
          break;
        }
      }
    }
    const choice = chooseUpload(
      original,
      encoded.map(({ type, blob }) => ({ type, size: blob.size })),
    );
    if (choice === 'too-large') {
      throw new PrepareError('too-large');
    }
    if (choice === 'original') {
      return {
        blob: file,
        type: original.type!,
        width: original.width,
        height: original.height,
      };
    }
    return encoded[choice]!;
  } finally {
    bitmap.close();
  }
}
