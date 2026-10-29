import { ListExtension } from '@lexical/list';
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { $createHeadingNode, RichTextExtension } from '@lexical/rich-text';
import {
  createYWriter,
  editYState,
  type HeadlessYConfig,
  readYState,
  seedYState,
} from '@lexical/y/headless';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';

// Use your clients' extensions, all of them. With fewer (these two alone), editYState
// refuses, read only, any note holding a node it doesn't register: a link, a table…
const config: HeadlessYConfig = {
  extensions: [RichTextExtension, ListExtension],
  schemaVersion: 1, // your clients' schemaVersion
};

/** A new note's state: content-hashed, so seeding it twice merges into one copy. */
export function seedNote(title: string): Uint8Array {
  return seedYState(config, () => {
    const heading = $createHeadingNode('h1').append($createTextNode(title));
    $getRoot().append(heading);
  });
}

// Who the server writes as: one writer per agent or integration, created once per
// process. It keeps one client id per note, so a note edited a thousand times carries
// one client id for it, not a thousand. Pass `writer: null` for a one-off anonymous id.
const writer = createYWriter('jot AI');

/**
 * Append a line to a stored note. `update` is what to apply and broadcast;
 * `clientID` is who wrote it, to credit to the writer in your attribution.
 */
export function appendLine(state: Uint8Array, text: string) {
  const append = () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  };
  const { update, state: next, clientID } = editYState(state, config, append, { writer });
  return { update, state: next, clientID };
}

/** Read a note as Markdown. Nothing is written. */
export function toMarkdown(state: Uint8Array): string {
  return readYState(state, config, () => $convertToMarkdownString(TRANSFORMERS));
}
