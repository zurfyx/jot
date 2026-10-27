/**
 * A note with one of everything jot can hold, as a Lexical editor state:
 * headings, the three list kinds (a checked and an unchecked to-do), a quote,
 * a code block, a table, a link and every inline format.
 */

const BOLD = 1;
const ITALIC = 2;
const STRIKETHROUGH = 4;
const UNDERLINE = 8;
const CODE = 16;

function text(value: string, format = 0) {
  return { type: 'text', version: 1, detail: 0, format, mode: 'normal', style: '', text: value };
}

function block(type: string, children: unknown[], extra: Record<string, unknown> = {}) {
  return { type, version: 1, direction: null, format: '', indent: 0, children, ...extra };
}

function paragraph(...children: unknown[]) {
  return block('paragraph', children, { textFormat: 0, textStyle: '' });
}

function heading(tag: 'h1' | 'h2' | 'h3', value: string) {
  return block('heading', [text(value)], { tag });
}

function list(listType: 'bullet' | 'number' | 'check', items: [string, boolean?][]) {
  return block(
    'list',
    items.map(([value, checked], index) =>
      block('listitem', [text(value)], {
        value: index + 1,
        ...(listType === 'check' ? { checked: checked ?? false } : {}),
      }),
    ),
    { listType, start: 1, tag: listType === 'number' ? 'ol' : 'ul' },
  );
}

function cell(value: string, header: boolean) {
  return block('tablecell', [paragraph(text(value))], {
    headerState: header ? 1 : 0,
    colSpan: 1,
    rowSpan: 1,
    width: null,
    backgroundColor: null,
  });
}

function row(values: string[], header = false) {
  return block(
    'tablerow',
    values.map((value) => cell(value, header)),
    { height: null },
  );
}

export const RICH_NOTE = block('root', [
  heading('h1', 'Team offsite'),
  paragraph(
    text('Plain, '),
    text('bold', BOLD),
    text(', '),
    text('italic', ITALIC),
    text(', '),
    text('underlined', UNDERLINE),
    text(', '),
    text('struck', STRIKETHROUGH),
    text(', '),
    text('inline code', CODE),
    text(' and a '),
    block('link', [text('link to Lexical')], {
      url: 'https://lexical.dev',
      rel: 'noreferrer',
      target: null,
      title: null,
    }),
    text('.'),
  ),
  heading('h2', 'Agenda'),
  list('bullet', [['Morning: roadmap review'], ['Afternoon: hack session']]),
  list('number', [['Book the room'], ['Send the agenda']]),
  heading('h3', 'To do'),
  list('check', [
    ['Order lunch', true],
    ['Print badges', false],
  ]),
  block('quote', [text('The link is the key: whoever has it can edit.')]),
  block(
    'code',
    [
      text('const doc = new Y.Doc();'),
      { type: 'linebreak', version: 1 },
      text('doc.get("lexical-y");'),
    ],
    {
      language: 'js',
    },
  ),
  block(
    'table',
    [row(['Who', 'Brings'], true), row(['Ana', 'Snacks']), row(['Gerard', 'Projector'])],
    {
      colWidths: [160, 160],
      rowStriping: false,
    },
  ),
  paragraph(text('The end.')),
]);
