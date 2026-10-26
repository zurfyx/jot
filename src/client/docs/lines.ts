import { $isElementNode, $getRoot, type LexicalEditor, type LexicalNode } from 'lexical';

/**
 * The keys of the editor's line elements in document order: the blocks whose
 * children are all inline (paragraphs, headings, quotes, list items holding
 * text, the paragraphs inside table cells). @lexical/y stores each of them as
 * the text before one ¶ marker, in the same order, so the inspector can pair
 * the n-th line row with the n-th key.
 */
export function lineKeys(editor: LexicalEditor): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];
  const visit = (node: LexicalNode) => {
    if (!$isElementNode(node)) {
      return;
    }
    if ($isLine(node)) {
      lines.push({ key: node.getKey(), text: node.getTextContent() });
      return;
    }
    node.getChildren().forEach(visit);
  };
  editor.getEditorState().read(() => visit($getRoot()));
  return lines;
}

function $isLine(node: LexicalNode): boolean {
  return (
    $isElementNode(node) &&
    !node.isInline() &&
    node.getParent() !== null &&
    node.getChildren().every((child) => !$isElementNode(child) || child.isInline())
  );
}

/** The key of the line element holding `node`, or null (call inside a read). */
export function $lineKeyOf(node: LexicalNode | null): string | null {
  let current = node;
  while (current !== null && !$isLine(current)) {
    current = current.getParent();
  }
  return current?.getKey() ?? null;
}
