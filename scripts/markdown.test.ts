import { describe, expect, it } from 'vitest';

import { decode, htmlToMarkdown } from './markdown';

/** The converter behind /docs/<slug>.md (D32), on markup like React's for the docs. */

const base = 'https://jot.rovira.sh/';
const article = (html: string) =>
  htmlToMarkdown(`<div><article>${html}</article></div>`, (e) => e.tag === 'article', { base });

describe('the HTML to Markdown converter', () => {
  it('turns headings, paragraphs and inline formats into Markdown', () => {
    expect(
      article(
        '<header><p>Start / Quick start</p><h1>Quick start</h1></header><p>Give it a <b>doc</b>, an <em>editor</em> and <code>initialize()</code>.</p><h2>In jot</h2>',
      ),
    ).toBe(
      'Start / Quick start\n\n# Quick start\n\nGive it a **doc**, an *editor* and `initialize()`.\n\n## In jot\n',
    );
  });

  it('makes links absolute and keeps inline code inside them', () => {
    expect(
      article(
        '<p>See <a href="/docs/relay">the relay</a> and <a href="https://x.dev/a"><code>a.ts</code></a>.</p>',
      ),
    ).toBe('See [the relay](https://jot.rovira.sh/docs/relay) and [`a.ts`](https://x.dev/a).\n');
  });

  it('keeps a code block whole, with its language, and drops its Copy button', () => {
    const code = 'const a = 1;\n\nif (a &lt; 2) {\n  run(`x`);\n}';
    expect(
      article(
        `<figure><figcaption><a href="https://github.com/x/a.ts">a.ts</a><button type="button"><span>Copy</span></button></figcaption><pre tabindex="0" data-language="ts"><code><span class="k">const</span> a = 1;\n\nif (a &lt; 2) {\n  run(\`x\`);\n}</code></pre></figure>`,
      ),
    ).toBe(`[a.ts](https://github.com/x/a.ts)\n\n\`\`\`ts\n${decode(code)}\n\`\`\`\n`);
  });

  it('writes lists, nested blocks in them, and numbered lists', () => {
    expect(
      article(
        '<ul><li><b>Text</b> carries formats.</li><li><p>One.</p><p>Two.</p></li></ul><ol><li>First</li><li>Second</li></ol>',
      ),
    ).toBe('- **Text** carries formats.\n- One.\n\n  Two.\n\n1. First\n2. Second\n');
  });

  it('writes a table with its header row, and a callout as a quote', () => {
    expect(
      article(
        '<div><table><thead><tr><th>Type</th><th>Body</th></tr></thead><tbody><tr><td><code>0</code></td><td>a | b</td></tr></tbody></table></div><aside><b>Why?</b><div>Because.</div></aside>',
      ),
    ).toBe('| Type | Body |\n| --- | --- |\n| `0` | a \\| b |\n\n> **Why?**\n>\n> Because.\n');
  });

  it('leaves out what only a browser needs, and escapes formatting characters in text', () => {
    expect(
      article(
        '<div aria-hidden="true">frame</div><p>a_b *c* <span data-motion="moving">x</span><span data-motion="still">done</span></p><svg><path></path></svg><p>line<br/>break</p>',
      ),
    ).toBe('a\\_b \\*c\\* done\n\nline  \nbreak\n');
  });

  it('reads character references, comments and void elements', () => {
    expect(article('<p>Grandma&#x27;s &amp; &quot;yours&quot;<!-- --> <img src="x"/>!</p>')).toBe(
      'Grandma\'s & "yours" !\n',
    );
  });

  it('fails when the HTML has no part to convert', () => {
    expect(() => htmlToMarkdown('<p>x</p>', (e) => e.tag === 'article', { base })).toThrow();
  });
});
