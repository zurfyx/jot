import { signal } from '@lexical/extension';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setState,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import {
  createContext,
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { IMAGE_ALT_MAX, isOwnImagePath } from '../../../shared/images';
import { useEditable, useSignal } from '../useSignal';
import type { ImageHost, LocalUpload } from './controller';
import type { ImageData } from './ImageNode';
import { altState, IMAGE_NODE_TYPE } from './states';

/**
 * The note an image is rendered for. Without it (an editor that is not a
 * note page, such as the docs' inspector) no image is shown.
 */
export const ImageHostContext = createContext<ImageHost | null>(null);

/** After this long, someone else's upload is taken as one that will never finish. */
export const STALE_UPLOAD_MS = 2 * 60 * 1000;

const NO_UPLOADS = signal<ReadonlyMap<string, LocalUpload>>(new Map());

/** Native events stopped at the alt field, so the editor around it never handles them. */
const FIELD_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'paste',
  'cut',
  'copy',
  'drop',
  'compositionstart',
  'compositionupdate',
  'compositionend',
] as const;

function useNodeSelected(editor: LexicalEditor, nodeKey: NodeKey): boolean {
  return useSyncExternalStore(
    (onChange) => editor.registerUpdateListener(onChange),
    () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        return $isNodeSelection(selection) && selection.has(nodeKey);
      }),
  );
}

/** True once an upload that started at `started` is older than STALE_UPLOAD_MS. */
function useStale(started: number, active: boolean): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const remaining = started + STALE_UPLOAD_MS - Date.now();
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [started, active]);
  return active && now - started > STALE_UPLOAD_MS;
}

function AltField({
  editor,
  nodeKey,
  alt,
}: {
  editor: LexicalEditor;
  nodeKey: NodeKey;
  alt: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (value: string) => {
      const next = altState.parse(value.trim());
      if (next === alt || !editor.isEditable()) {
        return;
      }
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node !== null && node.getType() === IMAGE_NODE_TYPE) {
          $setState(node, altState, next);
        }
      });
    },
    [editor, nodeKey, alt],
  );

  // Native listeners: every event stops at the field, so the editor around
  // it never sees it (React's own handlers would only run after the
  // editor's), and the field handles Enter and Escape itself.
  useEffect(() => {
    const input = ref.current;
    if (input === null) {
      return;
    }
    const stop = (event: Event) => {
      event.stopPropagation();
      if (event.type !== 'keydown') {
        return;
      }
      const { key } = event as globalThis.KeyboardEvent;
      if (key === 'Enter') {
        event.preventDefault();
        commit(input.value);
        editor.focus();
      } else if (key === 'Escape') {
        event.preventDefault();
        input.value = alt;
        editor.focus();
      }
    };
    for (const type of FIELD_EVENTS) {
      input.addEventListener(type, stop);
    }
    return () => {
      for (const type of FIELD_EVENTS) {
        input.removeEventListener(type, stop);
      }
    };
  }, [commit, editor, alt]);

  return (
    <label className="jot-image-alt">
      <span className="jot-image-alt-label">Alt text</span>
      <input
        ref={ref}
        className="jot-image-alt-input"
        type="text"
        defaultValue={alt}
        placeholder="Describe the image"
        maxLength={IMAGE_ALT_MAX}
        onBlur={(event) => commit(event.currentTarget.value)}
        aria-label="Alt text"
      />
    </label>
  );
}

/**
 * An image node on the page: the image when its path is one of this note's
 * images, an upload placeholder with progress while this tab uploads it, a
 * quiet placeholder while someone else does, and a notice instead of any
 * path that is not this note's (nothing is requested for it).
 */
export function ImageView({
  editor,
  nodeKey,
  src,
  alt,
  width,
  height,
  upload,
  started,
}: ImageData & { editor: LexicalEditor; nodeKey: NodeKey }) {
  const host = useContext(ImageHostContext);
  const uploads = useSignal(host?.uploads ?? NO_UPLOADS);
  const selected = useNodeSelected(editor, nodeKey);
  const editable = useEditable(editor);
  const [broken, setBroken] = useState(false);
  const local = upload === '' ? undefined : uploads.get(upload);
  const stale = useStale(started, upload !== '' && local === undefined);
  const own = host !== null && src !== '' && isOwnImagePath(src, host.noteId);

  const sized = width > 0 && height > 0;
  const frameStyle: CSSProperties | undefined = sized
    ? { aspectRatio: `${width} / ${height}`, width: `${width}px` }
    : undefined;
  const className = `jot-image${selected ? ' is-selected' : ''}`;

  if (local !== undefined) {
    const percent = Math.round(local.progress * 100);
    return (
      <figure className={className} data-testid="image" data-state="uploading">
        <div className="jot-image-frame is-uploading" style={frameStyle}>
          <img className="jot-image-img" src={local.previewUrl} alt="" draggable={false} />
          <div
            className="jot-image-progress"
            role="progressbar"
            aria-label={`Uploading ${alt === '' ? 'image' : alt}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
        <figcaption className="jot-image-caption">Uploading… {percent}%</figcaption>
      </figure>
    );
  }

  if (upload !== '') {
    return (
      <figure
        className={className}
        data-testid="image"
        data-state={stale ? 'unfinished' : 'pending'}
      >
        <div className="jot-image-frame is-empty" style={frameStyle}>
          <span className="jot-image-message">
            {stale ? 'This image’s upload didn’t finish.' : 'Someone is uploading an image…'}
          </span>
        </div>
      </figure>
    );
  }

  if (!own) {
    return (
      <figure className={className} data-testid="image" data-state="foreign">
        <div className="jot-image-frame is-empty">
          <span className="jot-image-message">
            Image not shown: it isn’t stored with this note.
          </span>
        </div>
      </figure>
    );
  }

  return (
    <figure className={className} data-testid="image" data-state={broken ? 'broken' : 'ready'}>
      {broken ? (
        <div className="jot-image-frame is-empty" style={frameStyle}>
          <span className="jot-image-message">This image is no longer available.</span>
        </div>
      ) : (
        <img
          className="jot-image-img"
          src={src}
          alt={alt}
          width={sized ? width : undefined}
          height={sized ? height : undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
      {selected && editable && <AltField key={alt} editor={editor} nodeKey={nodeKey} alt={alt} />}
    </figure>
  );
}
