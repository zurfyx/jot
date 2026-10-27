import type { ComponentType, RefObject } from 'react';

import { AskAIDockItem, AskAISurface } from './ai/AskAI';
import { ModelMenuItem, ModelPanel } from './ai/ModelPanel';
import { BlameChip, BlameMenuToggle, BlameSurface } from './blame/Blame';
import { ExampleBanner, ExampleSurface, ReplayDemoItem } from './example/Example';
import type { NoteSession } from './session';

/**
 * Extension points for features that add to the editor's chrome without
 * editing it: Ask AI sits in `dockStart`, tints its target from `surface` and puts its AI model
 * setting in `menuPanel`; blame puts its chip in
 * `dockEnd`, Show blame in `menuTop`, its margin in `surface`, and flashes
 * blame from `session.onReconnect`; the example note puts its banner in
 * `banner`, Replay demo in `menuTop` and runs its demo from `surface`.
 */
export interface NoteFeature {
  id: string;
  /** In the dock, between Aa and ⋯, before `dockEnd` items. */
  dockStart?: ComponentType<{ session: NoteSession }>;
  /** In the dock, right before ⋯. */
  dockEnd?: ComponentType<{ session: NoteSession }>;
  /** At the top of the ⋯ menu; build it from MenuItem and MenuToggle. */
  menuTop?: ComponentType<{ session: NoteSession; close: () => void }>;
  /**
   * A ⋯ menu item, after Note info, that opens a panel of the feature's own
   * in the menu's place, as Note info does.
   */
  menuPanel?: {
    Item: ComponentType<{ session: NoteSession; open: () => void }>;
    Panel: ComponentType<{ session: NoteSession; viaKeyboard: boolean }>;
  };
  /** Above the note's text, below the read-only and full notices. */
  banner?: ComponentType<{ session: NoteSession }>;
  /** Over the note's surface (positioned relative to it), like remote carets. */
  surface?: ComponentType<{
    session: NoteSession;
    surfaceRef: RefObject<HTMLDivElement | null>;
  }>;
}

/** The features mounted on every note page, in order. */
export const NOTE_FEATURES: readonly NoteFeature[] = [
  {
    id: 'ai',
    dockStart: AskAIDockItem,
    surface: AskAISurface,
    menuPanel: { Item: ModelMenuItem, Panel: ModelPanel },
  },
  { id: 'blame', dockEnd: BlameChip, menuTop: BlameMenuToggle, surface: BlameSurface },
  { id: 'example', banner: ExampleBanner, menuTop: ReplayDemoItem, surface: ExampleSurface },
];
