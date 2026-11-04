/**
 * The frozen layout steps the Worker bundles (D34): one place, so a release
 * whose Lexical pin lacks a step ships without it. The `@lexical/y` this
 * release pins ships `1to2`; `2to3` joins the list in the release that pins a
 * `@lexical/y` with it (identity's layout 3).
 */
import step1to2 from '@lexical/y/migrate/1to2';

export const LAYOUT_STEPS = [step1to2] as const;

/** The layout the last bundled step reaches: what shadow receipts migrate a copy to. */
export const SHADOW_LAYOUT = LAYOUT_STEPS[LAYOUT_STEPS.length - 1]!.to;
