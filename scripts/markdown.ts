/**
 * jot's prerendered HTML as Markdown (D32), for `llms.txt`'s pages: a small
 * converter for the markup React renders for the docs and the landing page,
 * which is well formed and escaped. It keeps what a reader needs (headings,
 * paragraphs, lists, links, code with its language, tables, callouts) and
 * drops what only a browser needs (buttons, decorations hidden from assistive
 * technology, an animation's moving frames).
 */

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** Text with its character references read. */
export function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, ref: string) => {
    const lower = ref.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[lower] ?? '';
  });
}

/** The HTML as a tree (comments dropped). */
export function parse(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  const token =
    /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(token)) {
    const [whole, closing, rawTag, rawAttrs, selfClosing, text] = match;
    const top = stack.at(-1)!;
    if (text !== undefined) {
      top.children.push(decode(text));
      continue;
    }
    if (rawTag === undefined) {
      continue; // a comment
    }
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.findLastIndex((element) => element.tag === tag);
      if (at > 0) {
        stack.length = at;
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [, name, value] of (rawAttrs ?? '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) {
      attrs[name!.toLowerCase()] = decode(value ?? '');
    }
    const element: Element = { tag, attrs, children: [] };
    top.children.push(element);
    if (!selfClosing && !VOID.has(tag) && !whole.endsWith('/>')) {
      stack.push(element);
    }
  }
  return root;
}

/** The first element (depth first) that `test` accepts. */
export function find(node: Node, test: (element: Element) => boolean): Element | undefined {
  if (typeof node === 'string') return undefined;
  if (test(node)) return node;
  for (const child of node.children) {
    const found = find(child, test);
    if (found !== undefined) return found;
  }
  return undefined;
}

function textOf(node: Node): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

/** Whether an element is there for the browser only. */
function skipped(element: Element): boolean {
  return (
    element.attrs['aria-hidden'] === 'true' ||
    element.attrs['data-motion'] === 'moving' ||
    ['button', 'script', 'style', 'svg', 'template', 'noscript'].includes(element.tag)
  );
}

/** Characters that would start Markdown formatting in running text. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_])/g, '\\$1');
}

export interface MarkdownOptions {
  /** Relative links are made absolute against it (`https://jot.rovira.sh`). */
  base: string;
}

function inline(node: Node, options: MarkdownOptions): string {
  if (typeof node === 'string') {
    return escapeText(node.replace(/\s+/g, ' '));
  }
  if (skipped(node)) return '';
  const inner = () => node.children.map((child) => inline(child, options)).join('');
  switch (node.tag) {
    case 'br':
      return '\n';
    case 'code': {
      const code = textOf(node);
      const fence = code.includes('`') ? '``' : '`';
      return code === '' ? '' : `${fence}${code}${fence}`;
    }
    case 'b':
    case 'strong': {
      const text = inner().trim();
      return text === '' ? '' : `**${text}**`;
    }
    case 'em':
    case 'i': {
      const text = inner().trim();
      return text === '' ? '' : `*${text}*`;
    }
    case 'a': {
      const text = inner().trim();
      const href = node.attrs.href;
      if (href === undefined || text === '') return text;
      return `[${text}](${new URL(href, options.base).href})`;
    }
    default:
      return inner();
  }
}

/** Joins inline Markdown into a paragraph: one line, but for line breaks. */
function paragraph(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('  \n');
}

function blocks(element: Element, options: MarkdownOptions): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = paragraph(run.map((node) => inline(node, options)).join(''));
    if (text !== '') out.push(text);
    run = [];
  };
  for (const child of element.children) {
    if (typeof child !== 'string' && BLOCK.has(child.tag) && !skipped(child)) {
      flush();
      out.push(...block(child, options));
    } else if (typeof child !== 'string' && skipped(child)) {
      // Dropped, with its subtree.
    } else if (typeof child !== 'string' && child.attrs.role === 'img') {
      flush();
      if (child.attrs['aria-label']) out.push(escapeText(child.attrs['aria-label']));
    } else {
      run.push(child);
    }
  }
  flush();
  return out;
}

function list(element: Element, ordered: boolean, options: MarkdownOptions): string {
  let index = 0;
  return element.children
    .filter((child): child is Element => typeof child !== 'string' && child.tag === 'li')
    .filter((item) => !skipped(item))
    .map((item) => {
      index += 1;
      const marker = ordered ? `${index}.` : '-';
      const body = blocks(item, options).join('\n\n');
      const pad = ' '.repeat(marker.length + 1);
      return `${marker} ${body.split('\n').join(`\n${pad}`)}`.replace(/\n\s+\n/g, '\n\n');
    })
    .join('\n');
}

function table(element: Element, options: MarkdownOptions): string {
  const rows: string[][] = [];
  const walk = (node: Node) => {
    if (typeof node === 'string') return;
    if (node.tag === 'tr') {
      rows.push(
        node.children
          .filter((cell): cell is Element => typeof cell !== 'string')
          .filter((cell) => cell.tag === 'td' || cell.tag === 'th')
          .map((cell) => paragraph(inline(cell, options)).replace(/\|/g, '\\|')),
      );
      return;
    }
    node.children.forEach(walk);
  };
  walk(element);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  return [line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function block(element: Element, options: MarkdownOptions): string[] {
  const heading = /^h([1-6])$/.exec(element.tag);
  if (heading !== null) {
    const text = paragraph(inline(element, options));
    return text === '' ? [] : [`${'#'.repeat(Number(heading[1]))} ${text}`];
  }
  switch (element.tag) {
    case 'p': {
      const text = paragraph(inline(element, options));
      return text === '' ? [] : [text];
    }
    case 'ul':
    case 'ol': {
      const text = list(element, element.tag === 'ol', options);
      return text === '' ? [] : [text];
    }
    case 'pre': {
      const language = element.attrs['data-language'] ?? '';
      const code = textOf(element).replace(/\n+$/, '');
      const fence = code.includes('```') ? '````' : '```';
      return [`${fence}${language}\n${code}\n${fence}`];
    }
    case 'table': {
      const text = table(element, options);
      return text === '' ? [] : [text];
    }
    case 'aside':
    case 'blockquote':
      return [
        blocks(element, options)
          .join('\n\n')
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`))
          .join('\n'),
      ];
    case 'figcaption': {
      const text = paragraph(inline(element, options));
      return text === '' ? [] : [text];
    }
    default:
      return blocks(element, options);
  }
}

/** An element's content as Markdown. */
export function toMarkdown(element: Element, options: MarkdownOptions): string {
  return `${blocks(element, options).join('\n\n').trim()}\n`;
}

/** The Markdown of the part of `html` that `test` picks (the docs' article, the landing page's main). */
export function htmlToMarkdown(
  html: string,
  test: (element: Element) => boolean,
  options: MarkdownOptions,
): string {
  const element = find(parse(html), test);
  if (element === undefined) {
    throw new Error('markdown: the HTML has no part to convert.');
  }
  return toMarkdown(element, options);
}
