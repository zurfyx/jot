import { ListExtension } from '@lexical/list';
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { $createHeadingNode, RichTextExtension } from '@lexical/rich-text';
import { editYState, type HeadlessYConfig, readYState, seedYState } from '@lexical/y/headless';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';

// The same extensions as the browsers' editors, so the server writes what they read.
const config: HeadlessYConfig = { extensions: [RichTextExtension, ListExtension] };

/** A new note's state: content-hashed, so seeding it twice merges into one copy. */
export function seedNote(title: string): Uint8Array {
  return seedYState(config, () => {
    const heading = $createHeadingNode('h1').append($createTextNode(title));
    $getRoot().append(heading);
  });
}

/** Append a line to a stored note. `update` is what to apply and broadcast. */
export function appendLine(state: Uint8Array, text: string) {
  const { update, state: next } = editYState(state, config, () => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  });
  return { update, state: next };
}

/** Read a note as Markdown. Nothing is written. */
export function toMarkdown(state: Uint8Array): string {
  return readYState(state, config, () => $convertToMarkdownString(TRANSFORMERS));
}
