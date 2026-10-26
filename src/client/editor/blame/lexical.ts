import { $getRoot, $isElementNode, type ElementNode, type LexicalNode } from 'lexical';

export interface LexicalLine {
  key: string;
  text: string;
}

function isLine(element: ElementNode): boolean {
  for (const child of element.getChildren()) {
    if ($isElementNode(child) && !child.isInline()) {
      return false;
    }
  }
  return true;
}

/**
 * Lexical's lines in document order: a DFS over the editor state taking the
 * block elements whose children are inline (paragraphs, headings, list
 * items, quotes, code blocks, table cells' paragraphs). Call inside a read.
 */
export function $lexicalLines(): LexicalLine[] {
  const lines: LexicalLine[] = [];
  const visit = (node: LexicalNode, depth: number) => {
    if (!$isElementNode(node) || depth > 64) {
      return;
    }
    for (const child of node.getChildren()) {
      if (!$isElementNode(child) || child.isInline()) {
        continue;
      }
      if (isLine(child)) {
        lines.push({ key: child.getKey(), text: child.getTextContent() });
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit($getRoot(), 0);
  return lines;
}
