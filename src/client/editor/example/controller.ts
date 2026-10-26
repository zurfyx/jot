import { computed, type ReadonlySignal, signal } from '@lexical/extension';
import * as Y from '@y/y';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';

import {
  adoptExample,
  type ExampleFlag,
  isExampleCreator,
  readExampleFlag,
  writeExampleFlag,
} from '../../examples';
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
  /** This tab runs the example's demo collaborators. */
  active: ReadonlySignal<boolean>;
  /** The note takes edits: binding active and not full. Replay needs it. */
  writable: ReadonlySignal<boolean>;
  /** The script is running. */
  playing: ReadonlySignal<boolean>;
  /** ⋯ → Replay demo: puts the demo's parts back and runs the script again. */
  replay(): void;
  /**
   * Starts the example on this page if this tab created it and no other tab
   * runs it (a duplicated tab copies the flag): after the first sync, the
   * demo collaborators join, an empty note is seeded, and the first visit
   * plays the script. Returns the stop (leaving the page).
   */
  start(): () => void;
}

/** What the controller needs from the page, so tests can stand in for it. */
export interface ExampleDeps {
  isCreator(id: string): boolean;
  readFlag(id: string): ExampleFlag | null;
  writeFlag(id: string, flag: ExampleFlag): void;
  /** Moves the address to the note's link. */
  adopt(id: string): void;
  /**
   * Runs `granted()` once this tab holds the example's lock, waiting while
   * another tab holds it; the lock is held until the returned promise
   * settles. Aborting `signal` gives up a request still waiting.
   */
  lock(name: string, granted: () => Promise<void>, signal: AbortSignal): void;
  /** The script lands at once (reduced motion). */
  instant(): boolean;
}

function webLock(name: string, granted: () => Promise<void>, signal: AbortSignal): void {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) {
    // No Web Locks (old browsers): run without one.
    void granted();
    return;
  }
  // Waiting rather than `ifAvailable`: React Strict Mode's remount asks again
  // before the first release lands, and a duplicated tab takes over when the
  // original closes.
  locks.request(name, { signal }, () => granted()).catch(() => undefined);
}

const pageDeps: ExampleDeps = {
  isCreator: isExampleCreator,
  readFlag: readExampleFlag,
  writeFlag: writeExampleFlag,
  adopt: adoptExample,
  lock: webLock,
  instant: () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
};

const states = new WeakMap<NoteSession, ExampleState>();

export function exampleState(session: NoteSession): ExampleState {
  let state = states.get(session);
  if (state === undefined) {
    state = createExampleState(session);
    states.set(session, state);
  }
  return state;
}

/**
 * "You" in the script: types at the end of the first agenda item through the
 * page's own editor, so it is this browser's person in blame. The caret
 * follows the typing only if it is already there, or if the person has not
 * edited yet and the page has focus (then it moves there first).
 */
function createYouTyper(session: NoteSession, writable: () => boolean) {
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
      if (!writable() || !editor.isEditable()) {
        return;
      }
      const root = editor.getRootElement();
      const focused =
        root !== null && typeof document !== 'undefined' && root.contains(document.activeElement);
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

export function createExampleState(
  session: NoteSession,
  deps: ExampleDeps = pageDeps,
): ExampleState {
  const active = signal(false);
  const playing = signal(false);
  const writable = computed(
    () => session.status.value === 'active' && session.cap.value !== 'full',
  );
  let cast: (DemoCast & { dispose(): void; resetYou(): void }) | null = null;
  let run: AbortController | null = null;

  const stopRun = () => {
    run?.abort();
    run = null;
    playing.value = false;
  };

  const play = (reset: boolean) => {
    if (cast === null || !writable.peek()) {
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
    runDemo(cast, { instant: deps.instant(), signal: controller.signal })
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
    const host = {
      doc: session.doc,
      awareness: session.awareness,
      connection: session.connection,
      writable: () => writable.peek(),
    };
    // New client ids each time (never reused); blame groups them by person
    // id, and an idle peer writes no registry entry.
    const ana = createInTabPeer(host, ANA);
    const ai = createInTabPeer(host, JOT_AI_DEMO);
    const you = createYouTyper(session, () => writable.peek());
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
    if (deps.readFlag(id) === 'played') {
      // A reload of this tab: the collaborators come back, idle.
      placeIdleCarets(cast);
      return;
    }
    deps.writeFlag(id, 'played');
    // Checked on Ana's own copy, in the same update that writes the plan: a
    // plan another tab wrote first is never doubled.
    ana.edit(() => {
      if ($isEmptyNote()) {
        $writeExample(session.link());
        $getRoot().getFirstChild()?.selectEnd();
      }
    });
    // Both carets show from the start: jot AI's rests after the first line.
    ai.edit(() => {
      $getRoot().getChildAtIndex(1)?.selectEnd();
    });
    // Blame is what the example is about.
    blameState(session).setOn(true);
    deps.adopt(id);
    play(false);
  };

  return {
    active,
    writable,
    playing,
    replay() {
      play(true);
    },
    start() {
      const id = session.noteId;
      if (!deps.isCreator(id)) {
        return () => undefined;
      }
      let stopped = false;
      let held = false;
      let release: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const ready = () =>
        !stopped && held && cast === null && writable.peek() && session.everSynced.peek();
      const check = () => {
        if (timer !== null || !ready()) {
          return;
        }
        // Outside the provider's sync handling that got here; checked again
        // then, since the note may have turned read only or full meanwhile.
        timer = setTimeout(() => {
          timer = null;
          if (ready()) {
            join(id);
          }
        });
      };
      // A note that turns read only or full stops the script at once.
      const stopWritable = writable.subscribe((value) => {
        if (!value) {
          stopRun();
        }
        check();
      });
      const stopSynced = session.everSynced.subscribe(check);

      // One tab per example runs it: a duplicated tab carries the same flag.
      const waiting = new AbortController();
      deps.lock(
        `jot-example:${id}`,
        () => {
          if (stopped) {
            return Promise.resolve();
          }
          held = true;
          active.value = true;
          check();
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
        waiting.signal,
      );

      return () => {
        stopped = true;
        waiting.abort();
        if (timer !== null) {
          clearTimeout(timer);
        }
        stopWritable();
        stopSynced();
        stopRun();
        cast?.dispose();
        cast = null;
        held = false;
        active.value = false;
        release?.();
        release = null;
      };
    },
  };
}
