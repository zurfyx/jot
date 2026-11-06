import { CodeExtension } from '@lexical/code-core';
import { LinkExtension } from '@lexical/link';
import { CheckListExtension, ListExtension } from '@lexical/list';
import { RichTextExtension } from '@lexical/rich-text';
import { TableExtension } from '@lexical/table';
import { configExtension, defineExtension } from 'lexical';

/**
 * What a jot note can hold: its node types and the configuration that
 * changes what is stored. No styles, theme or DOM behaviour, so the Durable
 * Object reads notes with it too (`readYState`, D34). The page's editor adds
 * the rest (`jotEditorExtension`).
 */
export const jotNodesExtension = defineExtension({
  name: 'jot/nodes',
  dependencies: [
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    CodeExtension,
    LinkExtension,
    configExtension(TableExtension, { hasCellMerge: false, hasCellBackgroundColor: false }),
  ],
});
