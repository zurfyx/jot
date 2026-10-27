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
import * as stylex from '@stylexjs/stylex';
import {
  $getRoot,
  configExtension,
  defineExtension,
  type EditorThemeClasses,
  mergeRegister,
} from 'lexical';

import { colors, fonts } from '../theme/tokens.stylex';
import { cellScope, editorScope } from './editor.stylex';

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

/*
 * The note's look (D28). Lexical gives each node the classes its type maps
 * to, so several can meet on one element (a list and a checklist, a cell and
 * its paragraph); where two set the same property, the one that must win is
 * written under a condition, which StyleX orders after plain values.
 */
const styles = stylex.create({
  root: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    outlineStyle: 'none',
    color: colors['--ink'],
    // 18px Geist in the 616px text column keeps lines near 70 characters.
    fontSize: { default: '18px', '@media (max-width: 640px)': '16px' },
    lineHeight: 1.65,
    caretColor: colors['--accent'],
    overflowWrap: 'break-word',
  },
  // The first line is the title (no separate field): on whichever block is
  // first (TitleExtension below), and on the placeholder's first line.
  title: {
    marginTop: { default: null, ':first-child': 0 },
    marginBottom: { default: null, ':first-child': '14px' },
    fontSize: {
      default: null,
      ':first-child': { default: '34px', '@media (max-width: 640px)': '30px' },
    },
    lineHeight: { default: null, ':first-child': 1.18 },
    fontWeight: { default: null, ':first-child': 680 },
    letterSpacing: { default: null, ':first-child': '-0.022em' },
  },
  p: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: { default: '12px', [stylex.when.ancestor(':is(td, th)', cellScope)]: 0 },
  },
  h1: {
    marginTop: '28px',
    marginBottom: '10px',
    fontSize: '30px',
    lineHeight: 1.2,
    fontWeight: 680,
    letterSpacing: '-0.02em',
  },
  h2: {
    marginTop: '26px',
    marginBottom: '6px',
    fontSize: '21px',
    lineHeight: 1.3,
    fontWeight: 650,
    letterSpacing: '-0.01em',
  },
  h3: {
    marginTop: '20px',
    marginBottom: '4px',
    fontSize: '17.5px',
    lineHeight: 1.35,
    fontWeight: 650,
  },
  quote: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: '12px',
    paddingLeft: '14px',
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: colors['--rule-strong'],
    color: colors['--body'],
  },
  codeblock: {
    display: 'block',
    marginTop: 0,
    marginInline: 0,
    marginBottom: '12px',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: '8px',
    backgroundColor: colors['--hover'],
    fontFamily: fonts['--mono'],
    fontSize: '14.5px',
    lineHeight: 1.6,
    tabSize: 2,
    whiteSpace: 'pre-wrap',
  },
  list: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: '12px',
    paddingLeft: '24px',
  },
  // With `list` on the same element: a checklist's boxes sit in its padding.
  checklist: {
    paddingLeft: { default: null, [stylex.when.ancestor('[data-lexical-editor]', editorScope)]: 0 },
  },
  li: {
    marginBlock: '0.2em',
    marginInline: 0,
  },
  liNested: {
    listStyleType: 'none',
  },
  liUnchecked: {
    position: 'relative',
    paddingLeft: '28px',
    listStyleType: 'none',
    outlineStyle: 'none',
    '::before': {
      content: '""',
      position: 'absolute',
      top: '0.3em',
      left: 0,
      width: '17px',
      height: '17px',
      borderWidth: '1.5px',
      borderStyle: 'solid',
      borderColor: colors['--rule-strong'],
      borderRadius: '5px',
      cursor: 'pointer',
      transitionProperty: 'background-color, border-color',
      transitionDuration: '150ms',
      transitionTimingFunction: 'ease-out',
    },
  },
  liChecked: {
    position: 'relative',
    paddingLeft: '28px',
    listStyleType: 'none',
    outlineStyle: 'none',
    color: colors['--muted'],
    textDecoration: 'line-through',
    textDecorationColor: colors['--rule-strong'],
    '::before': {
      content: '""',
      position: 'absolute',
      top: '0.3em',
      left: 0,
      width: '17px',
      height: '17px',
      borderWidth: '1.5px',
      borderStyle: 'solid',
      borderColor: colors['--accent'],
      borderRadius: '5px',
      backgroundColor: colors['--accent'],
      cursor: 'pointer',
      transitionProperty: 'background-color, border-color',
      transitionDuration: '150ms',
      transitionTimingFunction: 'ease-out',
    },
    '::after': {
      content: '""',
      position: 'absolute',
      top: 'calc(0.3em + 4px)',
      left: '6px',
      width: '5px',
      height: '9px',
      borderStyle: 'solid',
      borderColor: colors['--bg'],
      borderTopWidth: 0,
      borderRightWidth: '2px',
      borderBottomWidth: '2px',
      borderLeftWidth: 0,
      transform: 'rotate(45deg)',
      pointerEvents: 'none',
    },
  },
  bold: {
    fontWeight: 650,
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecoration: 'line-through',
  },
  underline: {
    textDecoration: 'underline',
  },
  code: {
    paddingBlock: '0.12em',
    paddingInline: '0.32em',
    borderRadius: '4px',
    backgroundColor: colors['--hover'],
    fontFamily: fonts['--mono'],
    fontSize: '0.86em',
  },
  link: {
    color: colors['--accent'],
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  tableWrap: {
    overflowX: 'auto',
    marginTop: '6px',
    marginBottom: '14px',
  },
  // Every table sits in its scrolling wrapper (TableExtension's
  // hasHorizontalScroll, on by default), which carries the table's margins.
  table: {
    margin: 0,
    borderCollapse: 'collapse',
    fontSize: '16px',
  },
  cell: {
    minWidth: '72px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors['--rule'],
    textAlign: 'left',
    verticalAlign: 'top',
  },
  headerCell: {
    fontWeight: 600,
  },
});

/** The class string for Lexical: a plain `jot-*` name, then the StyleX classes. */
function cls(name: string, { className }: { className?: string }): string {
  return className === undefined ? name : `${name} ${className}`;
}

/** The title's classes, for the placeholder's first line. */
export const titleStyle = styles.title;

/**
 * Class names for Lexical's nodes. Each keeps a plain `jot-*` name beside its
 * StyleX classes: the docs' inspector and the tests find nodes by it.
 */
export const editorTheme: EditorThemeClasses = {
  root: cls('jot-editor', stylex.props(editorScope, styles.root)),
  paragraph: cls('jot-p', stylex.props(styles.p)),
  quote: cls('jot-quote', stylex.props(styles.quote)),
  code: cls('jot-codeblock', stylex.props(styles.codeblock)),
  heading: {
    h1: cls('jot-h1', stylex.props(styles.h1)),
    h2: cls('jot-h2', stylex.props(styles.h2)),
    h3: cls('jot-h3', stylex.props(styles.h3)),
    h4: cls('jot-h3', stylex.props(styles.h3)),
    h5: cls('jot-h3', stylex.props(styles.h3)),
    h6: cls('jot-h3', stylex.props(styles.h3)),
  },
  link: cls('jot-link', stylex.props(styles.link)),
  list: {
    ul: cls('jot-ul', stylex.props(styles.list)),
    ol: cls('jot-ol', stylex.props(styles.list)),
    checklist: cls('jot-checklist', stylex.props(styles.checklist)),
    listitem: cls('jot-li', stylex.props(styles.li)),
    listitemChecked: cls('jot-li-checked', stylex.props(styles.liChecked)),
    listitemUnchecked: cls('jot-li-unchecked', stylex.props(styles.liUnchecked)),
    nested: { listitem: cls('jot-li-nested', stylex.props(styles.liNested)) },
  },
  text: {
    bold: cls('jot-bold', stylex.props(styles.bold)),
    italic: cls('jot-italic', stylex.props(styles.italic)),
    code: cls('jot-code', stylex.props(styles.code)),
    strikethrough: cls('jot-strike', stylex.props(styles.strike)),
    underline: cls('jot-underline', stylex.props(styles.underline)),
    // Both set text-decoration, so Lexical takes this class instead of the
    // two: underlined, as when the underline's rule came last.
    underlineStrikethrough: cls('jot-underline jot-strike', stylex.props(styles.underline)),
  },
  table: cls('jot-table', stylex.props(styles.table)),
  tableCell: cls('jot-td', stylex.props(cellScope, styles.cell)),
  tableCellHeader: cls('jot-th', stylex.props(cellScope, styles.cell, styles.headerCell)),
  tableRow: 'jot-tr',
  // Global: hides the native selection inside a table selection (globals.css).
  tableSelection: 'jot-table-selection',
  tableScrollableWrapper: cls('jot-table-wrap', stylex.props(styles.tableWrap)),
};

/**
 * Gives the note's first block the title's classes, and takes them from the
 * block that stops being first. Update listeners run as Lexical commits, so
 * the title is styled in the same frame its block appears.
 */
export const TitleExtension = defineExtension({
  name: 'jot/title',
  // The docs' inspector is a jot editor with a first line of its own style.
  config: { disabled: false },
  register: (editor, { disabled }) => {
    if (disabled) {
      return () => {};
    }
    const classes = (stylex.props(styles.title).className ?? '').split(' ');
    let current: HTMLElement | null = null;
    const mark = () => {
      const key = editor.getEditorState().read(() => $getRoot().getFirstChild()?.getKey() ?? null);
      const element = key === null ? null : editor.getElementByKey(key);
      if (current !== null && current !== element) {
        current.classList.remove(...classes);
      }
      element?.classList.add(...classes);
      current = element;
    };
    return mergeRegister(
      editor.registerUpdateListener(mark),
      editor.registerRootListener(mark),
      () => current?.classList.remove(...classes),
    );
  },
});

/** What a jot note can hold. The collaboration binding is added per note. */
export const jotEditorExtension = defineExtension({
  name: 'jot/editor',
  namespace: 'jot',
  theme: editorTheme,
  dependencies: [
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    CodeExtension,
    LinkExtension,
    configExtension(ClickableLinkExtension, { newTab: true }),
    configExtension(TableExtension, { hasCellMerge: false, hasCellBackgroundColor: false }),
    configExtension(TabIndentationExtension, { maxIndent: 6 }),
    MarkdownShortcutsExtension,
    TitleExtension,
  ],
  onError: (error) => {
    console.error(error);
  },
});
