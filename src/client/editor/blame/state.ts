import { batch, computed, type ReadonlySignal, signal } from '@lexical/extension';

import { MERGED_FLASH_MS, type NoteSession } from '../session';
import { type BlameSnapshot, EMPTY_SNAPSHOT } from './attribution';

/** Blame's state for one note page. */
export interface BlameState {
  /** Show blame is on (the person's choice). */
  on: ReadonlySignal<boolean>;
  /** Blame is showing: on, or flashing after a reconnect. */
  visible: ReadonlySignal<boolean>;
  /** The focused person's id: everyone else fades. */
  focus: ReadonlySignal<string | null>;
  /** The latest attributions, kept only while blame is visible. */
  snapshot: ReadonlySignal<BlameSnapshot>;
  setOn(on: boolean): void;
  setFocus(personId: string | null): void;
  setSnapshot(snapshot: BlameSnapshot): void;
  /** Shows blame for a few seconds if it is off (after reconnecting from Work offline). */
  flash(): void;
  dispose(): void;
}

const states = new WeakMap<NoteSession, BlameState>();

/** Blame's state for `session`, created on first use and kept as long as the session. */
export function blameState(session: NoteSession): BlameState {
  let state = states.get(session);
  if (state === undefined) {
    state = createBlameState();
    states.set(session, state);
  }
  return state;
}

export function createBlameState(flashMs = MERGED_FLASH_MS): BlameState {
  const on = signal(false);
  const flashing = signal(false);
  const focus = signal<string | null>(null);
  const snapshot = signal<BlameSnapshot>(EMPTY_SNAPSHOT);
  const visible = computed(() => on.value || flashing.value);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  const stopFlash = () => {
    if (flashTimer !== null) {
      clearTimeout(flashTimer);
      flashTimer = null;
    }
    flashing.value = false;
  };
  const stopVisible = visible.subscribe((shown) => {
    if (!shown) {
      focus.value = null;
      snapshot.value = EMPTY_SNAPSHOT;
    }
  });
  return {
    on,
    visible,
    focus,
    snapshot,
    setOn(value) {
      // A choice made during a flash replaces it; in one batch, so blame
      // never hides in between (that would drop its snapshot and focus).
      batch(() => {
        stopFlash();
        on.value = value;
      });
    },
    setFocus(personId) {
      focus.value = personId;
    },
    setSnapshot(next) {
      if (visible.peek()) {
        snapshot.value = next;
      }
    },
    flash() {
      if (on.peek()) {
        return;
      }
      batch(() => {
        stopFlash();
        flashing.value = true;
      });
      flashTimer = setTimeout(() => {
        flashTimer = null;
        flashing.value = false;
      }, flashMs);
    },
    dispose() {
      stopFlash();
      stopVisible();
    },
  };
}
