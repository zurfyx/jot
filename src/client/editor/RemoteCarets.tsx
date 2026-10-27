import { createDOMRange, createRectsFromDOMRange } from '@lexical/selection';
import * as stylex from '@stylexjs/stylex';
import type { YCursor } from '@lexical/y';
import { type CSSProperties, type RefObject, useEffect, useState } from 'react';

import { colors, motion } from '../theme/tokens.stylex';
import { parsePeerUser } from './presence';
import type { NoteSession } from './session';

/** A name label shows while its caret moves, then shrinks to the bar. */
const LABEL_MS = 3000;

// Each collaborator's colour is `--peer`, set on their caret's wrapper.
const styles = stylex.create({
  layer: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  },
  selection: {
    position: 'absolute',
    backgroundColor: 'color-mix(in srgb, var(--peer) 22%, transparent)',
    borderRadius: '2px',
  },
  caret: {
    position: 'absolute',
    width: '2px',
    marginLeft: '-1px',
    backgroundColor: 'var(--peer)',
    borderRadius: '1px',
    transitionProperty: 'top, left',
    transitionDuration: '80ms',
    transitionTimingFunction: 'linear',
  },
  name: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    paddingBlock: '3px',
    paddingInline: '5px',
    borderRadius: '4px 4px 4px 0',
    backgroundColor: 'var(--peer)',
    color: colors['--peer-ink'],
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    transformOrigin: 'bottom left',
    transitionProperty: 'opacity, transform',
    transitionDuration: motion['--enter'],
    transitionTimingFunction: motion['--ease'],
  },
  nameIdle: {
    opacity: 0,
    transform: 'scale(0.85)',
  },
});

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Caret {
  clientID: number;
  name: string;
  color: number;
  caret: Box;
  selection: Box[];
  labelled: boolean;
}

function isCursor(value: unknown): value is YCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'anchor' in value &&
    'focus' in value &&
    (value as YCursor).anchor != null &&
    (value as YCursor).focus != null
  );
}

/**
 * Collaborators' carets and selections. Each client publishes its selection
 * as Yjs relative positions (`YBinding#getCursor`) in awareness; peers
 * resolve them against their own document (`$resolveCursor`) and draw them
 * over the page.
 */
export function RemoteCarets({
  session,
  surfaceRef,
}: {
  session: NoteSession;
  surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const { editor, binding, awareness } = session;
  const [carets, setCarets] = useState<Caret[]>([]);

  // Publish the local selection.
  useEffect(() => {
    let last = '';
    const publish = () => {
      if (session.status.peek() !== 'active') {
        return;
      }
      const cursor = binding.getCursor();
      const encoded = JSON.stringify(cursor);
      if (encoded !== last) {
        last = encoded;
        awareness.setLocalStateField('cursor', cursor);
      }
    };
    const stopStatus = session.status.subscribe(publish);
    const stopUpdates = editor.registerUpdateListener(publish);
    return () => {
      stopStatus();
      stopUpdates();
    };
  }, [awareness, binding, editor, session]);

  // Draw everyone else's.
  useEffect(() => {
    const moved = new Map<number, { cursor: string; at: number }>();
    let frame = 0;
    let labelTimer: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      frame = 0;
      const surface = surfaceRef.current;
      if (surface === null || session.status.peek() === 'pending') {
        setCarets([]);
        return;
      }
      const origin = surface.getBoundingClientRect();
      const box = (rect: DOMRect): Box => ({
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height,
      });
      const now = Date.now();
      const next: Caret[] = [];
      editor.getEditorState().read(
        () => {
          for (const [clientID, state] of awareness.getStates()) {
            if (clientID === awareness.clientID) {
              continue;
            }
            const user = parsePeerUser(state.user);
            const cursor: unknown = state.cursor;
            if (user === null || !isCursor(cursor)) {
              continue;
            }
            const encoded = JSON.stringify(cursor);
            const seen = moved.get(clientID);
            if (seen === undefined || seen.cursor !== encoded) {
              moved.set(clientID, {
                cursor: encoded,
                at: seen === undefined ? now - LABEL_MS : now,
              });
            }
            let points;
            try {
              points = binding.$resolveCursor(cursor);
            } catch {
              continue;
            }
            if (points === null) {
              continue;
            }
            const anchorNode = points.anchor.getNode();
            const focusNode = points.focus.getNode();
            const range = createDOMRange(
              editor,
              anchorNode,
              points.anchor.offset,
              focusNode,
              points.focus.offset,
            );
            const caretRange = createDOMRange(
              editor,
              focusNode,
              points.focus.offset,
              focusNode,
              points.focus.offset,
            );
            let caretRect = caretRange?.getClientRects()[0] ?? caretRange?.getBoundingClientRect();
            if (caretRect === undefined || caretRect.height === 0) {
              const element = editor.getElementByKey(focusNode.getKey());
              if (element === null) {
                continue;
              }
              const rect = element.getBoundingClientRect();
              const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || rect.height;
              caretRect = new DOMRect(rect.left, rect.top, 0, Math.min(lineHeight, rect.height));
            }
            const selection =
              range !== null && !range.collapsed
                ? createRectsFromDOMRange(editor, range).map(box)
                : [];
            next.push({
              clientID,
              name: user.name,
              color: user.color,
              caret: box(caretRect),
              selection,
              labelled: now - (moved.get(clientID)?.at ?? 0) < LABEL_MS,
            });
          }
        },
        { editor },
      );
      for (const clientID of moved.keys()) {
        if (!awareness.getStates().has(clientID)) {
          moved.delete(clientID);
        }
      }
      setCarets(next);
      if (labelTimer !== null) {
        clearTimeout(labelTimer);
        labelTimer = null;
      }
      if (next.some((caret) => caret.labelled)) {
        labelTimer = setTimeout(schedule, LABEL_MS);
      }
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(measure);
      }
    };

    awareness.on('change', schedule);
    const stopUpdates = editor.registerUpdateListener(schedule);
    const stopStatus = session.status.subscribe(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      awareness.off('change', schedule);
      stopUpdates();
      stopStatus();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      if (labelTimer !== null) {
        clearTimeout(labelTimer);
      }
    };
  }, [awareness, binding, editor, session, surfaceRef]);

  return (
    <div {...stylex.props(styles.layer)} aria-hidden="true">
      {carets.map((caret) => {
        const style = { '--peer': `var(--peer-${caret.color})` } as CSSProperties;
        return (
          <div key={caret.clientID} style={style} data-testid="remote-caret">
            {caret.selection.map((rect, i) => (
              <div key={i} {...stylex.props(styles.selection)} style={rect} />
            ))}
            <div
              {...stylex.props(styles.caret)}
              style={{ top: caret.caret.top, left: caret.caret.left, height: caret.caret.height }}
            >
              <span {...stylex.props(styles.name, !caret.labelled && styles.nameIdle)}>
                {caret.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
