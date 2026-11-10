// The highlighter's own chunk (D35), loaded by `CodeHighlightExtension` the
// first time a note holds a code block: Prism and its grammars, about 19 KB
// gzipped, which a note without code never fetches.

// First: tells Prism not to highlight the page's own <code> elements when it loads.
import './prismManual';

import { registerCodeHighlighting } from '@lexical/code-prism';

export { registerCodeHighlighting };
