/**
 * The frozen layout steps the Worker bundles (D34): one place, so a release
 * whose Lexical pin lacks a step ships without it. The `@lexical/y` this
 * release pins ships `1to2` and `2to3` (layout 3, its MIN_LAYOUT). Release R
 * only runs them on copies (shadow receipts); R+1 migrates notes with them.
 */
import step1to2 from '@lexical/y/migrate/1to2';
import step2to3 from '@lexical/y/migrate/2to3';

export const LAYOUT_STEPS = [step1to2, step2to3] as const;

/** The layout the last bundled step reaches: what shadow receipts migrate a copy to. */
export const SHADOW_LAYOUT = LAYOUT_STEPS[LAYOUT_STEPS.length - 1]!.to;
