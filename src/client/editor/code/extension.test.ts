import { $createCodeNode, $isCodeHighlightNode, $isCodeNode } from '@lexical/code-core';
import { buildEditorFromExtensions } from '@lexical/extension';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it, onTestFinished } from 'vitest';

import { jotNodesExtension } from '../../../shared/nodes';
import { editorTheme } from '../extensions';
import { CodeHighlightExtension, type CodeHighlighter } from './extension';
import { CODE_LANGUAGES } from './languages';

/** A highlighter that records where it is registered, loaded when the test says. */
function fakeHighlighter() {
  const registered = new Set<LexicalEditor>();
  let loads = 0;
  let settle: { resolve: (h: CodeHighlighter) => void; reject: (e: Error) => void } | null = null;
  const highlighter: CodeHighlighter = {
    registerCodeHighlighting: (editor) => {
      registered.add(editor);
      return () => registered.delete(editor);
    },
  };
  return {
    registered,
    loads: () => loads,
    load: () =>
      new Promise<CodeHighlighter>((resolve, reject) => {
        loads++;
        settle = { resolve, reject };
      }),
    resolve: async () => {
      settle?.resolve(highlighter);
      await Promise.resolve();
      await Promise.resolve();
    },
    reject: async () => {
      settle?.reject(new Error('offline'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function build(load: () => Promise<CodeHighlighter>, $initial?: () => void) {
  const editor = buildEditorFromExtensions(
    defineExtension({
      name: 'test',
      dependencies: [jotNodesExtension, configExtension(CodeHighlightExtension, { load })],
      ...($initial ? { $initialEditorState: $initial } : {}),
    }),
  );
  onTestFinished(() => editor.dispose());
  return editor;
}

const $paragraph = (text: string) =>
  $getRoot().append($createParagraphNode().append($createTextNode(text)));
const $code = (text: string) =>
  $getRoot().append($createCodeNode('js').append($createTextNode(text)));

describe('CodeHighlightExtension', () => {
  it('fetches nothing for a note without code, and the highlighter with its first code block', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(() => $paragraph('Just text'), { discrete: true });
    expect(fake.loads()).toBe(0);

    editor.update(() => $code('const a = 1;'), { discrete: true });
    expect(fake.loads()).toBe(1);
    expect(fake.registered.has(editor)).toBe(false);
    await fake.resolve();
    expect(fake.registered.has(editor)).toBe(true);

    // Once: more code blocks fetch nothing more.
    editor.update(() => $code('let b = 2;'), { discrete: true });
    expect(fake.loads()).toBe(1);
  });

  it('fetches it for a note that already holds a code block', () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load, () => $code('x'));
    editor.read(() => {}); // commits the initial state
    expect(fake.loads()).toBe(1);
  });

  it('fetches it when a whole state with a code block replaces the note', () => {
    const fake = fakeHighlighter();
    const source = build(fakeHighlighter().load);
    source.update(() => $code('x'), { discrete: true });
    const editor = build(fake.load);
    editor.setEditorState(editor.parseEditorState(source.getEditorState().toJSON()));
    expect(fake.loads()).toBe(1);
  });

  it('notices a code block added beside other blocks', () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(
      () => {
        $paragraph('Before');
        $code('x');
      },
      { discrete: true },
    );
    expect(fake.loads()).toBe(1);
  });

  it('fetches and highlights only while the note is editable', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(() => $code('x'), { discrete: true });
    editor.setEditable(false);
    await fake.resolve();
    expect(fake.registered.has(editor)).toBe(false);
    editor.setEditable(true);
    expect(fake.registered.has(editor)).toBe(true);
    editor.setEditable(false);
    expect(fake.registered.has(editor)).toBe(false);
  });

  it('fetches nothing for a read-only note with code, until it turns editable', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.setEditable(false);
    editor.update(() => $code('x'), { discrete: true });
    expect(fake.loads()).toBe(0);
    editor.setEditable(true);
    expect(fake.loads()).toBe(1);
    await fake.resolve();
    expect(fake.registered.has(editor)).toBe(true);
  });

  it('registers nothing on an editor disposed while the highlighter loads', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(() => $code('x'), { discrete: true });
    editor.dispose();
    await fake.resolve();
    expect(fake.registered.size).toBe(0);
  });

  it('unregisters the highlighter when the editor is disposed', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(() => $code('x'), { discrete: true });
    await fake.resolve();
    expect(fake.registered.has(editor)).toBe(true);
    editor.dispose();
    expect(fake.registered.size).toBe(0);
  });

  it('tries again with the next code block after a failed fetch (offline)', async () => {
    const fake = fakeHighlighter();
    const editor = build(fake.load);
    editor.update(
      () => {
        $paragraph('text');
        $code('x');
      },
      { discrete: true },
    );
    await fake.reject();
    expect(fake.registered.size).toBe(0);
    // An edit away from the code block fetches nothing.
    editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd().insertText('!'), {
      discrete: true,
    });
    expect(fake.loads()).toBe(1);
    editor.update(() => $code('y'), { discrete: true });
    expect(fake.loads()).toBe(2);
    await fake.resolve();
    expect(fake.registered.has(editor)).toBe(true);
  });
});

/** A line of each language with its keywords, strings, numbers, comments and names. */
const SAMPLES: Record<string, string> = {
  plain: 'just text 42',
  c: '#include <stdio.h>\nint main(void) { printf("%d", 42); return 0; } // c',
  clike: 'if (a) { return "b"; } // c',
  cpp: 'class A { public: int f() const { return 42; } }; // c',
  css: '@media screen { .a > #b:hover { color: #fff !important; width: 2px; } }',
  go: 'package main\nfunc main() { fmt.Println("hi", 42, true) } // c',
  html: '<!DOCTYPE html><a href="/x" class=y>&amp; link</a><!-- c -->',
  java: '@Override public static void main(String[] a) { int x = 42; } // c',
  js: 'const f = async (a) => `t ${a}` + /re/g.test("s") + 42; // c\nclass B extends A {}',
  markdown: '# Title\n**bold** _it_ `code` [link](https://x.y)\n> quote\n- item',
  objc: '@interface A : NSObject\n- (void)f { NSLog(@"hi %d", 42); } // c',
  powershell: 'function Get-A { param($x) Write-Host "hi $x" 42 } # c',
  py: 'def f(a: int) -> str:\n    return f"{a}" if True else None  # c\n@dec\nclass A: pass',
  rust: 'fn main() { let x: i32 = 42; println!("{}", x); } // c\n#[derive(Debug)] struct A;',
  sql: "SELECT a, COUNT(*) FROM t WHERE b = 'x' AND c > 42; -- c",
  swift: 'func f(_ a: Int) -> String { return "\\(a)" } // c\n@objc class A {}',
  typescript: 'interface A { b?: number } type C = A & { d: "e" }; let f: A = { b: 42 }; // c',
  xml: '<?xml version="1.0"?><a b="c"><![CDATA[x]]></a>',
};

/** Prism token types jot leaves in the text's colour. */
const UNSTYLED = new Set([
  'operator',
  'entity',
  'url',
  'plain',
  'parameter',
  'interpolation',
  'content',
]);

describe('the token colours', () => {
  it('cover every token type the highlighter makes in every language jot lists', async () => {
    const { registerCodeHighlighting } = await import('@lexical/code-prism');
    const editor = buildEditorFromExtensions(
      defineExtension({ name: 'tokens', dependencies: [jotNodesExtension], theme: editorTheme }),
    );
    onTestFinished(() => editor.dispose());
    const stop = registerCodeHighlighting(editor);
    onTestFinished(stop);
    expect(Object.keys(SAMPLES).sort()).toEqual(CODE_LANGUAGES.map(([id]) => id).sort());

    const missing = new Set<string>();
    for (const [language, sample] of Object.entries(SAMPLES)) {
      editor.update(
        () => {
          const lines = sample.split('\n');
          const code = $createCodeNode(language);
          lines.forEach((line, index) => {
            code.append($createTextNode(line));
            if (index < lines.length - 1) {
              code.append($createTextNode('\n'));
            }
          });
          $getRoot().clear().append(code);
        },
        { discrete: true },
      );
      const types = editor.getEditorState().read(() => {
        const code = $getRoot().getFirstChild();
        expect($isCodeNode(code)).toBe(true);
        return $isCodeNode(code)
          ? code
              .getChildren()
              .filter($isCodeHighlightNode)
              .map((node) => node.getHighlightType())
          : [];
      });
      if (language !== 'plain') {
        expect(types.filter(Boolean).length, language).toBeGreaterThan(0);
      }
      for (const type of types) {
        if (type && !UNSTYLED.has(type) && !(type in (editorTheme.codeHighlight ?? {}))) {
          missing.add(`${language}: ${type}`);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
