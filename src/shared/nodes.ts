import { CodeExtension } from '@lexical/code-core';
import { BlockIdExtension } from '@lexical/extension';
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
 *
 * Every block stores an id (`BlockIdExtension`, D38): a new block gets a
 * random one; a block stored without one (written before D38) shows an id
 * derived from its Yjs identity, the same on every client, and stores it on
 * its next edit. `repairTransforms: false`, as `YCollabExtension` needs: the
 * naming update sets ids and nothing else.
 */
export const jotNodesExtension = defineExtension({
  name: 'jot/nodes',
  dependencies: [
    configExtension(BlockIdExtension, { repairTransforms: false }),
    RichTextExtension,
    ListExtension,
    CheckListExtension,
    CodeExtension,
    LinkExtension,
    configExtension(TableExtension, { hasCellMerge: false, hasCellBackgroundColor: false }),
  ],
});
