import { type ReadonlySignal, signal } from '@lexical/extension';
import * as Y from '@y/y';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';

import { adoptExample, isExampleCreator, readExampleFlag, writeExampleFlag } from '../../examples';
import { blameState } from '../blame/state';
import { createInTabPeer, type PeerPerson } from '../peers/peer';
import type { NoteSession } from '../session';
import { $agendaItem, $isEmptyNote, $lastText, $writeExample, EXAMPLE } from './content';
import { type DemoCast, DemoAborted, placeIdleCarets, resetDemo, runDemo } from './script';

/** The demo collaborators: orange and violet, as in every example (docs/design.md). */
export const ANA: PeerPerson = {
  personId: 'demo-ana',
  name: 'Ana (demo)',
  color: 1,
  kind: 'demo',
};
export const JOT_AI_DEMO: PeerPerson = {
  personId: 'demo-jot-ai',
  name: 'jot AI (demo)',
  color: 2,
  kind: 'demo',
};

/** The example note on one page (D20). */
export interface ExampleState {
  /** This tab created the example: it runs the demo collaborators. */
  active: ReadonlySignal<boolean>;
  /** The script is running. */
  playing: ReadonlySignal<boolean>;
  /** ⋯ → Replay demo: puts the demo's parts back and runs the script again. */
  replay(): void;
  /**
   * Starts the example on this page if this tab created it: after the first
   * sync, the demo collaborators join, an empty note is seeded, and the
   * first visit plays the script. Returns the stop (leaving the page).
   */
  start(): () => void;
}

const states = new WeakMap<NoteSession, ExampleState>();

export function exampleState(session: NoteSession): ExampleState {
  let state = states.get(session);
  if (state === undefined) {
    state = createExampleState(session);
    states.set(session, state);
  }
  return state;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * "You" in the script: types at the end of the first agenda item through the
 * page's own editor, so it is this browser's person in blame. The caret
 * follows the typing only if it is already there, or if the person has not
 * edited yet and the page has focus (then it moves there first).
 */
function createYouTyper(session: NoteSession) {
  const { editor, doc, binding } = session;
  let scripting = false;
  let edited = false;
  let placed = false;
  const onTransaction = (tr: Y.Transaction) => {
    if (!scripting && tr.local && tr.origin === binding) {
      edited = true;
    }
  };
  doc.on('afterTransaction', onTransaction);
  return {
    /** Each run may place the caret once. */
    reset() {
      placed = false;
    },
    type(text: string) {
      if (!editor.isEditable()) {
        return;
      }
      const root = editor.getRootElement();
      const focused = root !== null && root.contains(document.activeElement);
      scripting = true;
      try {
        editor.update(
          () => {
            const item = $agendaItem(EXAMPLE.agendaItems[0]);
            const last = item === null ? null : $lastText(item);
            if (last === null) {
              return;
            }
            const size = last.getTextContentSize();
            if (!placed && !edited && focused) {
              last.select(size, size);
            }
            placed = true;
            const selection = $getSelection();
            const caretHere =
              $isRangeSelection(selection) &&
              selection.isCollapsed() &&
              selection.anchor.key === last.getKey() &&
              selection.anchor.offset === size;
            last.spliceText(size, 0, text, caretHere);
          },
          { discrete: true },
        );
      } catch (error) {
        console.warn(error);
      } finally {
        scripting = false;
      }
    },
    dispose() {
      doc.off('afterTransaction', onTransaction);
    },
  };
}

function createExampleState(session: NoteSession): ExampleState {
  const active = signal(false);
  const playing = signal(false);
  let cast: (DemoCast & { dispose(): void; resetYou(): void }) | null = null;
  let run: AbortController | null = null;

  const play = (reset: boolean) => {
    if (cast === null) {
      return;
    }
    run?.abort();
    const controller = new AbortController();
    run = controller;
    if (reset) {
      resetDemo(cast);
    }
    cast.resetYou();
    playing.value = true;
    runDemo(cast, { instant: prefersReducedMotion(), signal: controller.signal })
      .catch((error: unknown) => {
        if (!(error instanceof DemoAborted)) {
          console.warn(error);
        }
      })
      .finally(() => {
        if (run === controller) {
          run = null;
          playing.value = false;
        }
      });
  };

  const join = (id: string) => {
    const ana = createInTabPeer(session, ANA);
    const ai = createInTabPeer(session, JOT_AI_DEMO);
    const you = createYouTyper(session);
    cast = {
      ana,
      ai,
      youType: (text) => you.type(text),
      resetYou: () => you.reset(),
      dispose() {
        you.dispose();
        ana.dispose();
        ai.dispose();
      },
    };
    if (readExampleFlag(id) === 'played') {
      // A reload of this tab: the collaborators come back, idle.
      placeIdleCarets(cast);
      return;
    }
    writeExampleFlag(id, 'played');
    const empty = session.editor.getEditorState().read($isEmptyNote);
    if (empty) {
      ana.edit(() => {
        $writeExample(session.link());
        $getRoot().getFirstChild()?.selectEnd();
      });
    }
    // Both carets show from the start: jot AI's rests after the first line.
    ai.edit(() => {
      $getRoot().getChildAtIndex(1)?.selectEnd();
    });
    // Blame is what the example is about.
    blameState(session).setOn(true);
    adoptExample(id);
    play(false);
  };

  return {
    active,
    playing,
    replay() {
      play(true);
    },
    start() {
      const id = session.noteId.peek();
      if (id === null || !isExampleCreator(id)) {
        return () => undefined;
      }
      active.value = true;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const check = () => {
        if (
          stopped ||
          cast !== null ||
          timer !== null ||
          session.status.peek() !== 'active' ||
          !session.everSynced.peek() ||
          session.cap.peek() === 'full'
        ) {
          return;
        }
        // Outside the provider's sync handling that got here.
        timer = setTimeout(() => {
          timer = null;
          if (!stopped && cast === null) {
            join(id);
          }
        });
      };
      const stops = [
        session.status.subscribe(check),
        session.everSynced.subscribe(check),
        session.cap.subscribe(check),
      ];
      return () => {
        stopped = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        for (const stop of stops) {
          stop();
        }
        run?.abort();
        run = null;
        cast?.dispose();
        cast = null;
        active.value = false;
        playing.value = false;
      };
    },
  };
}
