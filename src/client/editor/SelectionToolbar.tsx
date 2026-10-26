import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type LexicalNode,
  type TextFormatType,
} from 'lexical';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { normalizeLinkUrl } from '../../shared/links';
import type { NoteSession } from './session';

interface ToolbarState {
  top: number;
  left: number;
  below: boolean;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  heading: boolean;
}

const TOOLBAR_HEIGHT = 40;
const GAP = 8;

function isInLink(node: LexicalNode): boolean {
  return $findMatchingParent(node, $isLinkNode) !== null;
}

/** B, I, Link, Code, H: floats over a non-empty selection. */
export function SelectionToolbar({ session }: { session: NoteSession }) {
  const { editor } = session;
  const [state, setState] = useState<ToolbarState | null>(null);
  const [linking, setLinking] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => {
      const root = editor.getRootElement();
      const active = document.activeElement;
      const focused =
        root !== null && (root.contains(active) || (toolbarRef.current?.contains(active) ?? false));
      if (!focused || !editor.isEditable()) {
        setState(null);
        setLinking(false);
        return;
      }
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (
          !$isRangeSelection(selection) ||
          selection.isCollapsed() ||
          selection.getTextContent().trim() === ''
        ) {
          if (!toolbarRef.current?.contains(document.activeElement)) {
            setState(null);
            setLinking(false);
          }
          return;
        }
        const native = window.getSelection();
        if (native === null || native.rangeCount === 0) {
          return;
        }
        const rect = native.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return;
        }
        const below = rect.top < TOOLBAR_HEIGHT + GAP * 2;
        const top = below ? rect.bottom + GAP : rect.top - TOOLBAR_HEIGHT - GAP;
        const left = Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120);
        const anchor = selection.anchor.getNode();
        const block = anchor.getTopLevelElement();
        setState({
          top,
          left,
          below,
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          code: selection.hasFormat('code'),
          link: isInLink(anchor) || isInLink(selection.focus.getNode()),
          heading: block !== null && $isHeadingNode(block),
        });
      });
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next === null || !toolbarRef.current?.contains(next)) {
        setTimeout(update);
      }
    };
    const removeUpdate = editor.registerUpdateListener(update);
    const onResize = () => update();
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      removeUpdate();
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [editor]);

  useEffect(() => {
    if (linking) {
      inputRef.current?.focus();
    }
  }, [linking]);

  if (state === null) {
    return null;
  }

  const format = (type: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
  const toggleHeading = () =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () =>
          state.heading ? $createParagraphNode() : $createHeadingNode('h2'),
        );
      }
    });
  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeLinkUrl(inputRef.current?.value ?? '');
    if (url !== null) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }
    setLinking(false);
    editor.focus();
  };

  return (
    <div
      ref={toolbarRef}
      className={`selection-toolbar${state.below ? ' is-below' : ''}`}
      style={{ top: state.top, left: state.left }}
      role="toolbar"
      aria-label="Format"
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) {
          event.preventDefault();
        }
      }}
    >
      {linking ? (
        <form className="toolbar-link" onSubmit={submitLink}>
          <input
            ref={inputRef}
            type="url"
            inputMode="url"
            placeholder="Paste a link"
            aria-label="Link address"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setLinking(false);
                editor.focus();
              }
            }}
          />
        </form>
      ) : (
        <>
          <ToolbarButton label="Bold" active={state.bold} onClick={() => format('bold')}>
            <b>B</b>
          </ToolbarButton>
          <ToolbarButton label="Italic" active={state.italic} onClick={() => format('italic')}>
            <i>I</i>
          </ToolbarButton>
          <ToolbarButton
            label={state.link ? 'Remove link' : 'Link'}
            active={state.link}
            onClick={() =>
              state.link ? editor.dispatchCommand(TOGGLE_LINK_COMMAND, null) : setLinking(true)
            }
          >
            Link
          </ToolbarButton>
          <ToolbarButton label="Code" active={state.code} onClick={() => format('code')}>
            Code
          </ToolbarButton>
          <ToolbarButton label="Heading" active={state.heading} onClick={toggleHeading}>
            H
          </ToolbarButton>
        </>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={active ? 'is-active' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
