import { CodeExtension } from '@lexical/code-core';
import { TabIndentationExtension } from '@lexical/extension';
import { ClickableLinkExtension, LinkExtension } from '@lexical/link';
import { CheckListExtension, ListExtension } from '@lexical/list';
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  registerMarkdownShortcuts,
  STRIKETHROUGH,
  type Transformer,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { RichTextExtension } from '@lexical/rich-text';
import { TableExtension } from '@lexical/table';
import { configExtension, defineExtension, type EditorThemeClasses } from 'lexical';

import { ImageExtension, shouldHandlePasteAsFiles } from './images/extension';

/** Markdown shortcuts while typing: `# `, `- `, `[] `, `> `, ```` ``` ````, `**b**`, `` `c` ``, links. */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
  CHECK_LIST,
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  LINK,
];

const MarkdownShortcutsExtension = defineExtension({
  name: 'jot/markdown-shortcuts',
  register: (editor) => registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS),
});

/** Class names for Lexical's nodes; the look lives in styles.css. */
export const editorTheme: EditorThemeClasses = {
  paragraph: 'jot-p',
  quote: 'jot-quote',
  code: 'jot-codeblock',
  heading: { h1: 'jot-h1', h2: 'jot-h2', h3: 'jot-h3', h4: 'jot-h3', h5: 'jot-h3', h6: 'jot-h3' },
  link: 'jot-link',
  list: {
    ul: 'jot-ul',
    ol: 'jot-ol',
    checklist: 'jot-checklist',
    listitem: 'jot-li',
    listitemChecked: 'jot-li-checked',
    listitemUnchecked: 'jot-li-unchecked',
    nested: { listitem: 'jot-li-nested' },
  },
  text: {
    bold: 'jot-bold',
    italic: 'jot-italic',
    code: 'jot-code',
    strikethrough: 'jot-strike',
    underline: 'jot-underline',
  },
  table: 'jot-table',
  tableCell: 'jot-td',
  tableCellHeader: 'jot-th',
  tableRow: 'jot-tr',
  tableSelection: 'jot-table-selection',
  tableScrollableWrapper: 'jot-table-wrap',
};

/**
 * What a jot note can hold. The collaboration binding is added per note; so
 * is inserting images, which needs the note (images/Images.tsx).
 */
export const jotEditorExtension = defineExtension({
  name: 'jot/editor',
  namespace: 'jot',
  theme: editorTheme,
  dependencies: [
    // Image files on the clipboard are pasted as images, even beside HTML (D26).
    configExtension(RichTextExtension, { shouldHandlePasteAsFiles }),
    ListExtension,
    CheckListExtension,
    CodeExtension,
    LinkExtension,
    configExtension(ClickableLinkExtension, { newTab: true }),
    configExtension(TableExtension, { hasCellMerge: false, hasCellBackgroundColor: false }),
    configExtension(TabIndentationExtension, { maxIndent: 6 }),
    MarkdownShortcutsExtension,
    ImageExtension,
  ],
  onError: (error) => {
    console.error(error);
  },
});
