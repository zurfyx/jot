import { createYDoc } from '@lexical/y/headless';
import * as Y from '@y/y';

/**
 * The size the relay would store for this document: its state re-encoded from a
 * gc-on document, as the room compacts it (D05). The page's own encoding is no
 * guide: the binding's undo stack keeps deleted content alive in the page's
 * document, so replacing a large passage a few times would count it again each
 * time and make a note look full long before the stored note is.
 */
export function compactedSize(doc: Y.Doc): number {
  const scratch = createYDoc(Y.encodeStateAsUpdate(doc));
  const size = Y.encodeStateAsUpdate(scratch).byteLength;
  scratch.destroy();
  return size;
}
