// Prism highlights every `<code class="language-…">` on the page once it
// loads, unless a global `Prism.manual` was set before it. jot highlights
// only through Lexical, so it sets it here, in the module `highlight.ts`
// imports before `@lexical/code-prism` (which loads Prism).
const scope = globalThis as { Prism?: { manual?: boolean } };
scope.Prism ??= { manual: true };
