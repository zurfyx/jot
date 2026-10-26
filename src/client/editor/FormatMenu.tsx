import { $createCodeNode, $isCodeNode } from '@lexical/code-core';
import { $isLinkNode, $toggleLink } from '@lexical/link';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  $isListNode,
  ListNode,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent, $getNearestNodeOfType } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  type BaseSelection,
  FORMAT_TEXT_COMMAND,
  type LexicalNode,
  type TextFormatType,
} from 'lexical';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { normalizeLinkUrl } from '../../shared/links';
import { Icon, type IconName, isIconName } from './icons';
import { imageBlockReason, pickImageFiles } from './images/controller';
import { keepEditorFocus, moveMenuFocus, useFocusFirstItem } from './menu';
import type { NoteSession } from './session';
import { useSignal } from './useSignal';

export type BlockType =
  'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'check' | 'quote' | 'code';

const BLOCKS: { type: BlockType; label: string; icon: IconName | string; hint: string }[] = [
  { type: 'paragraph', label: 'Text', icon: 'text', hint: '' },
  { type: 'h1', label: 'Heading 1', icon: 'H1', hint: '#' },
  { type: 'h2', label: 'Heading 2', icon: 'H2', hint: '##' },
  { type: 'h3', label: 'Heading 3', icon: 'H3', hint: '###' },
  { type: 'bullet', label: 'Bulleted list', icon: 'bullets', hint: '-' },
  { type: 'number', label: 'Numbered list', icon: 'numbered', hint: '1.' },
  { type: 'check', label: 'Todo list', icon: 'todo', hint: '[]' },
  { type: 'quote', label: 'Quote', icon: 'quote', hint: '>' },
  { type: 'code', label: 'Code', icon: 'codeblock', hint: '```' },
];

type InlineFormat = Extract<
  TextFormatType,
  'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'
>;

const FORMATS: { format: InlineFormat; label: string; icon: IconName }[] = [
  { format: 'bold', label: 'Bold', icon: 'bold' },
  { format: 'italic', label: 'Italic', icon: 'italic' },
  { format: 'underline', label: 'Underline', icon: 'underline' },
  { format: 'strikethrough', label: 'Strikethrough', icon: 'strike' },
  { format: 'code', label: 'Inline code', icon: 'code' },
];

interface FormatState {
  block: BlockType;
  formats: Record<InlineFormat, boolean>;
  link: boolean;
  collapsed: boolean;
}

const EMPTY: FormatState = {
  block: 'paragraph',
  formats: { bold: false, italic: false, underline: false, strikethrough: false, code: false },
  link: false,
  collapsed: true,
};

function isInLink(node: LexicalNode): boolean {
  return $findMatchingParent(node, $isLinkNode) !== null;
}

function $blockOf(node: LexicalNode): BlockType {
  const element =
    node.getKey() === 'root'
      ? node
      : ($findMatchingParent(node, (candidate) => {
          const parent = candidate.getParent();
          return parent !== null && $isRootOrShadowRoot(parent);
        }) ?? node.getTopLevelElementOrThrow());
  if ($isListNode(element)) {
    const list = $getNearestNodeOfType(node, ListNode) ?? element;
    return list.getListType();
  }
  if ($isHeadingNode(element)) {
    const tag = element.getTag();
    return tag === 'h1' || tag === 'h2' ? tag : 'h3';
  }
  if ($isQuoteNode(element)) {
    return 'quote';
  }
  if ($isCodeNode(element)) {
    return 'code';
  }
  return 'paragraph';
}

function $readFormatState(): FormatState {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return EMPTY;
  }
  const anchor = selection.anchor.getNode();
  return {
    block: $blockOf(anchor),
    formats: {
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      underline: selection.hasFormat('underline'),
      strikethrough: selection.hasFormat('strikethrough'),
      code: selection.hasFormat('code'),
    },
    link: isInLink(anchor) || isInLink(selection.focus.getNode()),
    collapsed: selection.isCollapsed(),
  };
}

/**
 * Aa: block types and inline formats, the operations the old selection
 * toolbar offered and more. The editor keeps its selection while the
 * popover is open (pointer presses don't take focus; the keyboard path
 * restores the last selection before acting).
 */
export function FormatMenu({
  session,
  viaKeyboard,
  close,
}: {
  session: NoteSession;
  viaKeyboard: boolean;
  close: () => void;
}) {
  const { editor } = session;
  const [state, setState] = useState<FormatState>(EMPTY);
  const [linking, setLinking] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = useRef<BaseSelection | null>(null);
  // Images need the network (D26): re-read whenever the connection changes.
  const connection = useSignal(session.connection);
  const workOffline = useSignal(session.workOffline);
  const imageBlocked =
    connection === 'connected' && !workOffline ? null : imageBlockReason(session);

  useFocusFirstItem(menuRef, viaKeyboard);

  useEffect(() => {
    const read = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          saved.current = selection.clone();
        }
        setState($readFormatState());
      });
    read();
    return editor.registerUpdateListener(read);
  }, [editor]);

  useEffect(() => {
    if (linking) {
      inputRef.current?.focus();
    }
  }, [linking]);

  /** Runs `fn` on the editor's selection, restoring it if focus took it away. */
  const act = (fn: () => void) => {
    // Never write to a note that is read only, even from a menu that was open
    // when it became so.
    if (!editor.isEditable()) {
      close();
      return;
    }
    editor.update(() => {
      if (!$isRangeSelection($getSelection()) && saved.current !== null) {
        $setSelection(saved.current.clone());
      }
      fn();
    });
  };

  const setBlock = (type: BlockType) => {
    // Choosing the current type again turns the block back into text.
    const target = type === state.block && type !== 'paragraph' ? 'paragraph' : type;
    act(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }
      switch (target) {
        case 'paragraph':
          $setBlocksType(selection, () => $createParagraphNode());
          break;
        case 'h1':
        case 'h2':
        case 'h3':
          $setBlocksType(selection, () => $createHeadingNode(target));
          break;
        case 'quote':
          $setBlocksType(selection, () => $createQuoteNode());
          break;
        case 'code':
          $setBlocksType(selection, () => $createCodeNode());
          break;
        case 'bullet':
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          break;
        case 'number':
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          break;
        case 'check':
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
          break;
      }
    });
    close();
    editor.focus();
  };

  const toggleFormat = (format: InlineFormat) => {
    act(() => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    });
  };

  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeLinkUrl(inputRef.current?.value ?? '');
    if (url !== null) {
      act(() => $toggleLink(url));
    }
    setLinking(false);
    close();
    editor.focus();
  };

  return (
    <div
      ref={menuRef}
      className="popover format-menu"
      role="menu"
      aria-label="Format"
      onKeyDown={linking ? undefined : moveMenuFocus}
      onMouseDown={keepEditorFocus}
    >
      {linking ? (
        <form className="link-form" onSubmit={submitLink} noValidate>
          <input
            ref={inputRef}
            className="link-input"
            type="url"
            inputMode="url"
            placeholder="Paste a link"
            aria-label="Link address"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setLinking(false);
                editor.focus();
              }
            }}
          />
        </form>
      ) : (
        <>
          <div className="menu-group" role="group" aria-label="Turn into">
            {BLOCKS.map((block) => (
              <button
                key={block.type}
                type="button"
                role="menuitemradio"
                aria-checked={state.block === block.type}
                className="menu-item"
                tabIndex={-1}
                onClick={() => setBlock(block.type)}
              >
                {isIconName(block.icon) ? (
                  <Icon name={block.icon} />
                ) : (
                  <span className="menu-glyph" aria-hidden="true">
                    {block.icon}
                  </span>
                )}
                <span className="menu-label">{block.label}</span>
                {block.hint !== '' && <span className="menu-hint mono">{block.hint}</span>}
              </button>
            ))}
          </div>
          <div className="format-row" role="group" aria-label="Text">
            {FORMATS.map(({ format, label, icon }) => (
              <button
                key={format}
                type="button"
                role="menuitemcheckbox"
                aria-checked={state.formats[format]}
                aria-label={label}
                title={label}
                className="icon-button"
                tabIndex={-1}
                onClick={() => toggleFormat(format)}
              >
                <Icon name={icon} />
              </button>
            ))}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={state.link}
              aria-label={state.link ? 'Remove link' : 'Link'}
              title={state.link ? 'Remove link' : 'Link'}
              className="icon-button"
              tabIndex={-1}
              disabled={!state.link && state.collapsed}
              onClick={() => {
                if (state.link) {
                  act(() => $toggleLink(null));
                } else {
                  setLinking(true);
                }
              }}
            >
              <Icon name="link" />
            </button>
          </div>
          <div className="menu-group insert-group" role="group" aria-label="Insert">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              tabIndex={-1}
              disabled={imageBlocked !== null}
              title={imageBlocked ?? 'Add an image from this device'}
              onClick={() => {
                const selection = saved.current;
                close();
                pickImageFiles(session, selection);
              }}
            >
              <Icon name="image" />
              <span className="menu-label">Image</span>
              {imageBlocked !== null && (
                <span className="menu-hint">{workOffline ? 'Working offline' : 'Offline'}</span>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
