/** A run of `length` characters at `start` in one of the editor's text nodes. */
export function runRange(node: Text, start: number, length: number): StaticRange {
  // Static: it doesn't follow DOM changes, so it costs nothing between paints.
  return new StaticRange({
    startContainer: node,
    startOffset: start,
    endContainer: node,
    endOffset: start + length,
  });
}

/** One Highlight per person, underlined in their colour. Lexical's DOM is untouched. */
export function underline(people: { color: string; ranges: StaticRange[] }[]) {
  const sheet = new CSSStyleSheet();
  const rules = people.map(({ color, ranges }, index) => {
    CSS.highlights.set(`blame-${index}`, new Highlight(...ranges));
    return `::highlight(blame-${index}) { text-decoration: underline 2px ${color}; }`;
  });
  sheet.replaceSync(rules.join('\n'));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    people.forEach((_, index) => CSS.highlights.delete(`blame-${index}`));
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  };
}
