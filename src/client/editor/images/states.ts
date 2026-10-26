import { createState } from 'lexical';

import { IMAGE_ALT_MAX, parseImagePath } from '../../../shared/images';

/**
 * An image node's values (D26), all NodeState so `@lexical/y` stores them
 * as attributes of the node. Each is parsed as untrusted input: any peer
 * can write any attribute.
 */

/** The node type, stored in documents: never rename it. */
export const IMAGE_NODE_TYPE = 'jot-image';

/** A jot image path, or '' for anything else (absolute URLs, data:, other paths). */
export const srcState = createState('src', {
  parse: (value): string =>
    typeof value === 'string' && parseImagePath(value) !== null ? value : '',
});

export const altState = createState('alt', {
  parse: (value): string => (typeof value === 'string' ? value.slice(0, IMAGE_ALT_MAX) : ''),
});

export const dimension = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : 0;

/** Pixel size of the stored image, so the page keeps its space before it loads (0 when unknown). */
export const widthState = createState('width', { parse: dimension });
export const heightState = createState('height', { parse: dimension });

const UPLOAD_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** While uploading: the uploading tab's id for this upload, else ''. */
export const uploadState = createState('upload', {
  parse: (value): string => (typeof value === 'string' && UPLOAD_ID.test(value) ? value : ''),
});

/** While uploading: when the upload started (ms), so others can tell one that never finished. */
export const startedState = createState('started', {
  parse: (value): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0,
});
