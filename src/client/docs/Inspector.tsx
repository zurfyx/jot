import './docs.css';

import { buildEditorFromExtensions, TabIndentationExtension } from '@lexical/extension';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { YCollabExtension } from '@lexical/y';
import * as Y from '@y/y';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  configExtension,
  defineExtension,
  type EditorThemeClasses,
  type LexicalEditor,
} from 'lexical';
import * as stylex from '@stylexjs/stylex';
import { Fragment, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { editorTheme, jotEditorExtension, TitleExtension } from '../editor/extensions';
import { colors, docs, fonts } from '../theme/tokens.stylex';
import { frame } from './inspectorFrame';
import { $lineKeyOf, lineKeys } from './lines';
import { C, prose } from './ui';
import { type Attr, readRows, type Row, type Segment, visibleText } from './yjsTree';

const STACKED = '@media (max-width: 1080px)';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Snapshot {
  rows: Row[];
  /** For each Yjs line, the key of its Lexical element (null when they disagree). */
  keys: (string | null)[];
}

function $seed() {
  const root = $getRoot();
  root.clear();
  root.append($createHeadingNode('h2').append($createTextNode('Agenda')));
  root.append(
    $createListNode('bullet').append(
      $createListItemNode().append(
        $createTextNode('Morning: roadmap review '),
        $createTextNode('with demos').toggleFormat('bold'),
      ),
      $createListItemNode().append($createTextNode('Afternoon: hack session')),
    ),
  );
  root.append($createParagraphNode().append($createTextNode('Who brings snacks?')));
}

function snapshot(doc: Y.Doc, editor: LexicalEditor): Snapshot {
  const rows = readRows(doc);
  const lexical = lineKeys(editor);
  const keys: (string | null)[] = [];
  for (const row of rows) {
    if (row.kind === 'line') {
      const match = lexical[row.line];
      keys.push(match !== undefined && match.text === row.text ? match.key : null);
    }
  }
  return { rows, keys };
}

/**
 * The live inspector: a small jot editor on a Y.Doc of its own (no server),
 * beside the `lexical-y` root as rows. Typing updates the rows; hovering a
 * line highlights its row, and hovering a row highlights its line.
 */
export default function Inspector() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [state, setState] = useState<Snapshot>({ rows: [], keys: [] });
  const [hover, setHoverState] = useState<number | null>(null);
  // Whichever moved last leads: the pointer over a line or row, or the caret.
  const [lead, setLead] = useState<'pointer' | 'caret'>('caret');
  const [caretKey, setCaretKey] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const created = buildEditorFromExtensions(
      defineExtension({
        name: 'jot/docs-inspector',
        // After jot's theme, so these classes replace its block classes.
        theme: inspectorTheme,
        dependencies: [
          jotEditorExtension,
          // Tab leaves the inspector, as it would any small field on a page.
          configExtension(TabIndentationExtension, { disabled: true }),
          // Its first line has the inspector's own style, not the note's title.
          configExtension(TitleExtension, { disabled: true }),
          // A local document is synced from the start: initialize at once.
          configExtension(YCollabExtension, { doc, synced: true }),
        ],
      }),
    );
    created.setRootElement(rootRef.current);
    created.update($seed, { discrete: true });

    // The rows follow the document: every content change is a Yjs update.
    let frame = 0;
    const refresh = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setState(snapshot(doc, created));
        });
      }
    };
    doc.on('update', refresh);
    // The caret only picks the active row: cheap, with no new snapshot.
    const stopUpdates = created.registerUpdateListener(({ editorState }) => {
      setLead('caret');
      // The line the caret is in, so typing shows its row.
      setCaretKey(
        editorState.read(() => {
          const selection = $getSelection();
          return $isRangeSelection(selection) ? $lineKeyOf(selection.focus.getNode()) : null;
        }),
      );
    });
    refresh();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditor(created);
    return () => {
      cancelAnimationFrame(frame);
      stopUpdates();
      doc.off('update', refresh);
      created.setRootElement(null);
      created.dispose();
      doc.destroy();
    };
  }, []);

  const caret = caretKey === null ? -1 : state.keys.indexOf(caretKey);
  const caretLine = caret === -1 ? null : caret;
  const active = lead === 'pointer' ? (hover ?? caretLine) : (caretLine ?? hover);

  // Any pointer move takes the lead back from the caret, even over the same line.
  const setHover = (line: number | null) => {
    setLead('pointer');
    if (line !== hover) {
      setHoverState(line);
    }
  };

  // Measure the active line's box, over the editor, without touching Lexical's DOM.
  useLayoutEffect(() => {
    const key = active === null ? null : state.keys[active];
    const surface = surfaceRef.current;
    if (editor === null || surface === null || key == null) {
      setBox(null);
      return;
    }
    const measure = () => {
      const element = editor.getElementByKey(key);
      if (element === null) {
        setBox(null);
        return;
      }
      const origin = surface.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      setBox({
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    // Line heights change when Geist arrives, and with the window's width.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) {
        measure();
      }
    });
    window.addEventListener('resize', measure);
    return () => {
      live = false;
      window.removeEventListener('resize', measure);
    };
  }, [active, editor, state]);

  const onEditorHover = (event: MouseEvent) => {
    if (editor === null) {
      return;
    }
    let target = event.target instanceof Node ? event.target : null;
    while (target !== null && target !== surfaceRef.current) {
      if (target instanceof HTMLElement) {
        const index = state.keys.findIndex(
          (key) => key !== null && editor.getElementByKey(key) === target,
        );
        if (index !== -1) {
          setHover(index);
          return;
        }
      }
      target = target.parentNode;
    }
    setHover(null);
  };

  return (
    <figure aria-label="Live inspector" {...stylex.props(frame.box)}>
      <div {...stylex.props(styles.pane, styles.editorPane)}>
        <p {...stylex.props(styles.label)}>Editor</p>
        <div
          ref={surfaceRef}
          onMouseMove={onEditorHover}
          onMouseLeave={() => setHover(null)}
          {...stylex.props(styles.surface)}
        >
          {box !== null && (
            <div
              aria-hidden="true"
              data-testid="inspector-line-hl"
              {...stylex.props(styles.lineHighlight)}
              style={box}
            />
          )}
          <div
            // `insp-editor` is the hook for the one rule docs.css keeps.
            className={`insp-editor ${stylex.props(styles.editor).className ?? ''}`}
            ref={rootRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Inspector editor"
            spellCheck={false}
            data-testid="inspector-editor"
          />
        </div>
      </div>
      <div {...stylex.props(styles.pane)}>
        <p {...stylex.props(styles.label)}>
          Yjs: <C xstyle={styles.labelCode}>doc.get('lexical-y')</C>
        </p>
        <ol
          data-testid="inspector-tree"
          onMouseLeave={() => setHover(null)}
          {...stylex.props(prose.list, styles.tree)}
        >
          {state.rows.map((row, i) => (
            <TreeRow
              key={i}
              row={row}
              active={row.kind === 'line' && row.line === active}
              onHover={setHover}
            />
          ))}
        </ol>
      </div>
    </figure>
  );
}

function TreeRow({
  row,
  active,
  onHover,
}: {
  row: Row;
  active: boolean;
  onHover: (line: number | null) => void;
}) {
  const rowProps = {
    ...stylex.props(styles.row, active && styles.rowActive),
    style: { paddingLeft: `${8 + row.depth * 16}px` },
    'data-testid': 'inspector-row',
  };
  if (row.kind === 'root' || row.kind === 'node') {
    return (
      <li {...rowProps}>
        <span {...stylex.props(styles.name)}>{row.name}</span> <Attrs attrs={row.attrs} />
      </li>
    );
  }
  if (row.kind === 'run') {
    return (
      <li {...rowProps}>
        <Segments segments={row.segments} /> <span {...stylex.props(styles.marker)}>¦</span>
      </li>
    );
  }
  return (
    <li
      {...rowProps}
      data-line={row.line}
      data-active={active ? 'true' : undefined}
      onMouseMove={() => onHover(row.line)}
    >
      <Segments segments={row.segments} /> <span {...stylex.props(styles.marker)}>¶</span>{' '}
      {row.marker.length > 0 ? <Attrs attrs={row.marker} /> : <span>{'{}'} paragraph</span>}
    </li>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          {segment.node !== undefined ? (
            <span {...stylex.props(styles.name)}>{segment.node}</span>
          ) : (
            <span {...stylex.props(styles.text)}>"{visibleText(segment.text)}"</span>
          )}
          {segment.attrs.length > 0 && <Attrs attrs={segment.attrs} />}
        </Fragment>
      ))}
    </>
  );
}

function Attrs({ attrs }: { attrs: Attr[] }) {
  if (attrs.length === 0) {
    return null;
  }
  return (
    <span>
      {'{'}
      {attrs.map((attr, i) => (
        <Fragment key={attr.key}>
          {i > 0 && ', '}
          {attr.key}: {attr.value}
        </Fragment>
      ))}
      {'}'}
    </span>
  );
}

const styles = stylex.create({
  pane: {
    minWidth: 0,
    paddingTop: 14,
    paddingInline: 16,
    paddingBottom: 16,
  },
  editorPane: {
    borderRightWidth: { default: 1, [STACKED]: 0 },
    borderRightStyle: { default: 'solid', [STACKED]: 'none' },
    borderRightColor: { default: colors['--rule'], [STACKED]: 'currentcolor' },
    borderBottomWidth: { default: null, [STACKED]: 1 },
    borderBottomStyle: { default: null, [STACKED]: 'solid' },
    borderBottomColor: { default: null, [STACKED]: colors['--rule'] },
  },
  // A paragraph of the article, restyled.
  label: {
    maxWidth: '68ch',
    marginTop: 0,
    marginInline: 0,
    marginBottom: 10,
    color: colors['--muted'],
    fontSize: 11.5,
    lineHeight: 1.7,
    fontWeight: 650,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  labelCode: {
    textTransform: 'none',
    letterSpacing: 0,
  },
  surface: {
    position: 'relative',
  },
  lineHighlight: {
    position: 'absolute',
    zIndex: 0,
    boxSizing: 'content-box',
    marginBlock: -2,
    marginInline: -6,
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: 6,
    backgroundColor: docs['--docs-hl'],
    pointerEvents: 'none',
  },
  editor: {
    position: 'relative',
    zIndex: 1,
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minHeight: 200,
    outline: 'none',
    color: colors['--ink'],
    fontSize: 15,
    lineHeight: 1.55,
    caretColor: colors['--accent'],
    overflowWrap: 'break-word',
  },
  tree: {
    marginTop: 0,
    listStyleType: 'none',
    // `font: 12.5px/1.7 var(--mono)`: the shorthand also resets the inherited
    // tabular figures.
    fontFamily: fonts['--mono'],
    fontSize: 12.5,
    lineHeight: 1.7,
    fontWeight: 'normal',
    fontVariantNumeric: 'normal',
  },
  row: {
    margin: 0,
    paddingBlock: 1,
    paddingRight: 8,
    borderRadius: 6,
    color: colors['--muted'],
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  rowActive: {
    backgroundColor: docs['--docs-hl'],
  },
  name: {
    color: colors['--ink'],
    fontWeight: 600,
  },
  text: {
    color: colors['--ink'],
  },
  marker: {
    color: colors['--peer-1'],
    fontWeight: 700,
  },
});

/*
 * The inspector's editor is a jot editor, set smaller in the article: these
 * classes replace jot's for its blocks. A first block that isn't a heading
 * takes a title's size and weight.
 */
const FIRST = ':first-child';

const blocks = stylex.create({
  first: {
    fontSize: { default: null, [FIRST]: 19 },
    lineHeight: { default: null, [FIRST]: 1.3 },
    fontWeight: { default: null, [FIRST]: 650 },
    letterSpacing: { default: null, [FIRST]: '-0.01em' },
  },
  margin: {
    marginTop: 0,
    marginInline: 0,
    marginBottom: 6,
  },
  p: {
    maxWidth: '68ch',
    color: colors['--body'],
    fontSize: { default: 16, [FIRST]: 19 },
    lineHeight: { default: 1.7, [FIRST]: 1.3 },
  },
  quote: {
    paddingLeft: 14,
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderLeftColor: colors['--rule-strong'],
    color: colors['--body'],
  },
  list: {
    maxWidth: '68ch',
    paddingLeft: 22,
  },
  li: {
    marginBlock: 6,
    marginInline: 0,
    color: colors['--body'],
    fontSize: 16,
    lineHeight: 1.7,
  },
  heading: {
    marginTop: 12,
    marginInline: 0,
    marginBottom: 4,
    fontSize: 17,
    lineHeight: 1.3,
    fontWeight: 650,
    letterSpacing: '-0.01em',
  },
  h1: {
    lineHeight: { default: 1.15, [FIRST]: 1.3 },
    fontWeight: { default: 680, [FIRST]: 650 },
    letterSpacing: { default: '-0.022em', [FIRST]: '-0.01em' },
  },
  h3: {
    lineHeight: { default: 1.35, [FIRST]: 1.3 },
    letterSpacing: { default: null, [FIRST]: '-0.01em' },
  },
  code: {
    display: 'block',
    marginTop: 0,
    marginInline: 0,
    marginBottom: { default: 12, [FIRST]: 8 },
    paddingBlock: 1,
    paddingInline: 5,
    borderRadius: 5,
    backgroundColor: colors['--hover'],
    color: colors['--ink'],
    fontFamily: fonts['--mono'],
    fontSize: { default: '0.86em', [FIRST]: 19 },
    lineHeight: { default: 1.6, [FIRST]: 1.3 },
    fontWeight: { default: null, [FIRST]: 650 },
    letterSpacing: { default: null, [FIRST]: '-0.01em' },
    tabSize: 2,
    whiteSpace: 'pre-wrap',
  },
});

const cls = (...styles: stylex.StyleXStyles[]) => stylex.props(...styles).className ?? '';

const h3 = cls(blocks.heading, blocks.h3);

const inspectorTheme: EditorThemeClasses = {
  paragraph: cls(blocks.margin, blocks.first, blocks.p),
  quote: cls(blocks.margin, blocks.quote, blocks.first),
  code: cls(blocks.code),
  heading: {
    h1: cls(blocks.heading, blocks.h1),
    h2: cls(blocks.heading),
    h3,
    h4: h3,
    h5: h3,
    h6: h3,
  },
  list: {
    ...editorTheme.list,
    ul: cls(blocks.margin, blocks.list, blocks.first),
    ol: cls(blocks.margin, blocks.list, blocks.first),
    // The article's list padding holds for to-do lists too.
    checklist: '',
    listitem: cls(blocks.li),
  },
};
