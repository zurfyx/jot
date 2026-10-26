import type { ComponentType, RefObject } from 'react';

import type { NoteSession } from './session';

/**
 * Extension points for features that add to the editor's chrome without
 * editing it: PR "ai" puts Ask AI in `dockStart`; PR "blame" puts its chip in
 * `dockEnd`, Show blame in `menuTop`, its margin in `surface`, and flashes
 * blame from `session.onReconnect`.
 */
export interface NoteFeature {
  id: string;
  /** In the dock, between Aa and ⋯, before `dockEnd` items. */
  dockStart?: ComponentType<{ session: NoteSession }>;
  /** In the dock, right before ⋯. */
  dockEnd?: ComponentType<{ session: NoteSession }>;
  /** At the top of the ⋯ menu; build it from MenuItem and MenuToggle. */
  menuTop?: ComponentType<{ session: NoteSession; close: () => void }>;
  /** Over the note's surface (positioned relative to it), like remote carets. */
  surface?: ComponentType<{
    session: NoteSession;
    surfaceRef: RefObject<HTMLDivElement | null>;
  }>;
}

/** The features mounted on every note page, in order. */
export const NOTE_FEATURES: readonly NoteFeature[] = [];
