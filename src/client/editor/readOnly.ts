import type { YReadOnlyCause } from '@lexical/y';

/**
 * What the read-only banner says, by the binding's cause. A newer jot is the
 * common case (D29, D25); the rest are rare, and each still says what to do.
 */
export function readOnlyMessage(cause: YReadOnlyCause | null): string {
  switch (cause?.code) {
    case 'unstorable-change':
    case 'unreadable-content':
      return 'Read only. Something in this note can’t be saved by this version of jot. Copy what you need, then reload.';
    case 'frozen':
      return 'Read only. Reload to keep editing.';
    default:
      return 'Read only. This note was written by a newer version of jot; reload to edit.';
  }
}
