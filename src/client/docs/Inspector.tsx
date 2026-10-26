import { buildEditorFromExtensions } from '@lexical/extension';
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
  type LexicalEditor,
} from 'lexical';
import { Fragment, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { jotEditorExtension } from '../editor/extensions';
import { $lineKeyOf, lineKeys } from './lines';
import { type Attr, readRows, type Row, type Segment, visibleText } from './yjsTree';

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
        dependencies: [
          jotEditorExtension,
          // A local document is synced from the start: initialize at once.
          configExtension(YCollabExtension, { doc, synced: true }),
        ],
      }),
    );
    created.setRootElement(rootRef.current);
    created.update($seed, { discrete: true });

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
    const stopUpdates = created.registerUpdateListener(({ editorState }) => {
      refresh();
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

  const setHover = (line: number | null) => {
    if (line !== hover) {
      setHoverState(line);
      setLead('pointer');
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
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
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
    <figure className="docs-inspector" aria-label="Live inspector">
      <div className="insp-pane insp-editor-pane">
        <p className="insp-label">Editor</p>
        <div
          className="insp-surface"
          ref={surfaceRef}
          onMouseMove={onEditorHover}
          onMouseLeave={() => setHover(null)}
        >
          {box !== null && <div className="insp-line-hl" style={box} aria-hidden="true" />}
          <div
            className="jot-editor insp-editor"
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
      <div className="insp-pane insp-tree-pane">
        <p className="insp-label">
          Yjs: <code>doc.get('lexical-y')</code>
        </p>
        <ol className="insp-tree" data-testid="inspector-tree" onMouseLeave={() => setHover(null)}>
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
  const indent = { paddingLeft: `${8 + row.depth * 16}px` };
  if (row.kind === 'root') {
    return (
      <li className="insp-row is-root" style={indent} data-testid="inspector-row">
        <span className="insp-name">{row.name}</span> <Attrs attrs={row.attrs} />
      </li>
    );
  }
  if (row.kind === 'node') {
    return (
      <li className="insp-row" style={indent} data-testid="inspector-row">
        <span className="insp-name">{row.name}</span> <Attrs attrs={row.attrs} />
      </li>
    );
  }
  if (row.kind === 'run') {
    return (
      <li className="insp-row" style={indent} data-testid="inspector-row">
        <Segments segments={row.segments} /> <span className="insp-marker">¦</span>
      </li>
    );
  }
  return (
    <li
      className={`insp-row is-line${active ? ' is-active' : ''}`}
      style={indent}
      data-testid="inspector-row"
      data-line={row.line}
      onMouseEnter={() => onHover(row.line)}
    >
      <Segments segments={row.segments} /> <span className="insp-marker">¶</span>{' '}
      {row.marker.length > 0 ? (
        <Attrs attrs={row.marker} />
      ) : (
        <span className="insp-attrs">{'{}'} paragraph</span>
      )}
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
            <span className="insp-name">{segment.node}</span>
          ) : (
            <span className="insp-text">"{visibleText(segment.text)}"</span>
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
    <span className="insp-attrs">
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
