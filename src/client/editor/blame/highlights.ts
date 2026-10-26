/**
 * Underlines through the CSS Custom Highlight API: one Highlight per person,
 * `jot-blame-N`, and a constructed style sheet giving `::highlight(jot-blame-N)`
 * a 2 px underline in that person's colour token. A focused person keeps
 * full colour; everyone else fades.
 */
import { PEER_COLORS } from '../presence';

export const HIGHLIGHT_PREFIX = 'jot-blame-';

export function highlightsSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight === 'function' &&
    typeof CSSStyleSheet === 'function' &&
    'adoptedStyleSheets' in Document.prototype
  );
}

export interface Painter {
  /** `people` in a stable order; index N paints as `jot-blame-N`. */
  paint(
    people: readonly { id: string; color: number }[],
    ranges: Map<string, Range[]>,
    focus: string | null,
  ): void;
  clear(): void;
}

export function createPainter(): Painter {
  if (!highlightsSupported()) {
    return { paint() {}, clear() {} };
  }
  const sheet = new CSSStyleSheet();
  let names: string[] = [];
  let css = '';
  let adopted = false;
  const clear = () => {
    for (const name of names) {
      CSS.highlights.delete(name);
    }
    names = [];
  };
  const paintNow = (
    people: readonly { id: string; color: number }[],
    ranges: Map<string, Range[]>,
    focus: string | null,
  ) => {
    clear();
    const rules: string[] = [];
    people.forEach((person, index) => {
      const name = `${HIGHLIGHT_PREFIX}${index}`;
      const list = ranges.get(person.id);
      if (list === undefined || list.length === 0) {
        return;
      }
      CSS.highlights.set(name, new Highlight(...list));
      names.push(name);
      const color = `var(--peer-${Math.abs(Math.trunc(person.color)) % PEER_COLORS})`;
      const shown =
        focus === null || focus === person.id
          ? color
          : `color-mix(in srgb, ${color} var(--blame-faded), transparent)`;
      rules.push(
        `::highlight(${name}){text-decoration:underline 2px ${shown};text-underline-offset:0.24em;text-decoration-skip-ink:none}`,
      );
    });
    const next = rules.join('\n');
    if (next !== css) {
      css = next;
      sheet.replaceSync(next);
    }
    if (!adopted) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      adopted = true;
    }
  };
  return {
    paint(people, ranges, focus) {
      try {
        paintNow(people, ranges, focus);
      } catch (error) {
        // Blame never breaks the page: without underlines, the margin still shows.
        console.warn('jot: blame could not paint underlines', error);
      }
    },
    clear() {
      clear();
      if (adopted) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
        adopted = false;
      }
    },
  };
}
