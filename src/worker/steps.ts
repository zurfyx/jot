/**
 * The layout migration the Worker runs (D34), in one place: the frozen steps
 * it bundles and the floor it migrates to. The `@lexical/y` this release pins
 * ships `1to2`, `2to3` and `3to4` (layout 4, its MIN_LAYOUT and SEED_LAYOUT).
 */
import { MIN_LAYOUT } from '@lexical/y/server';
import step1to2 from '@lexical/y/migrate/1to2';
import step2to3 from '@lexical/y/migrate/2to3';
import step3to4 from '@lexical/y/migrate/3to4';

/** Every step the Worker ships, in chain order. */
export const LAYOUT_STEPS = [step1to2, step2to3, step3to4] as const;

/** The layout the last bundled step reaches: what shadow receipts migrate a copy to. */
export const SHADOW_LAYOUT = LAYOUT_STEPS[LAYOUT_STEPS.length - 1]!.to;

/**
 * The layout every served root is migrated to on a note's first open: the
 * library's floor. Only roots below it migrate. Tests raise it per note
 * (development builds only, NoteRoom's test settings).
 */
export const LAYOUT_FLOOR = MIN_LAYOUT;
