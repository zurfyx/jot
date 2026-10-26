import { DRAG_DROP_PASTE } from '@lexical/rich-text';
import { COMMAND_PRIORITY_LOW } from 'lexical';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import type { NoteSession } from '../session';
import { useSignal } from '../useSignal';
import { imageHost, insertImageFiles, isCandidateImage } from './controller';
import { ImageHostContext } from './ImageView';

/** Images' message under the note's text: why an image couldn't be added. */
export function ImageNoticeBanner({ session }: { session: NoteSession }) {
  const host = imageHost(session);
  const notice = useSignal(host.notice);
  if (notice === null) {
    return null;
  }
  return (
    <p
      className="note-notice image-notice"
      role="status"
      key={notice.id}
      data-testid="image-notice"
    >
      {notice.text}{' '}
      <button type="button" className="text-button" onClick={() => host.dismissNotice()}>
        Dismiss
      </button>
    </p>
  );
}

/**
 * Renders every image node into its place in the editor (decorators, as
 * `@lexical/react` would, without it: D14), with the note it belongs to,
 * and adds pasted and dropped image files to the note.
 */
export function ImageSurface({ session }: { session: NoteSession }) {
  const { editor } = session;
  const host = imageHost(session);
  const decorators = useSyncExternalStore(
    (onChange) => editor.registerDecoratorListener(onChange),
    () => editor.getDecorators<ReactNode>(),
  );

  useEffect(
    () =>
      editor.registerCommand(
        DRAG_DROP_PASTE,
        (files) => {
          const images = files.filter(isCandidateImage);
          if (images.length === 0 && files.every((file) => !file.type.startsWith('image/'))) {
            // Not ours (text files, for one): let the editor handle them.
            return false;
          }
          void insertImageFiles(session, files);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, session],
  );

  return (
    <ImageHostContext.Provider value={host}>
      {Object.entries(decorators).map(([key, decorator]) => {
        const element = editor.getElementByKey(key);
        return element === null ? null : createPortal(decorator, element, key);
      })}
    </ImageHostContext.Provider>
  );
}
