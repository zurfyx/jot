import { describe, expect, it } from 'vitest';

import { caretTarget } from './clickToFocus';

const text = { left: 380, right: 1060, top: 80, bottom: 300 };

describe('caretTarget', () => {
  it('sends a press below the text to the end of the note', () => {
    expect(caretTarget(720, 300, text)).toEqual({ kind: 'end' });
    expect(caretTarget(100, 850, text)).toEqual({ kind: 'end' });
  });

  it('sends a press in a side margin to the nearest point of that line', () => {
    expect(caretTarget(40, 150, text)).toEqual({ kind: 'point', x: 381, y: 150 });
    expect(caretTarget(1400, 150, text)).toEqual({ kind: 'point', x: 1059, y: 150 });
  });

  it('sends a press above the title into the first line', () => {
    expect(caretTarget(700, 20, text)).toEqual({ kind: 'point', x: 700, y: 81 });
  });

  it('sends every press on a note without blocks to the end', () => {
    expect(caretTarget(700, 20, null)).toEqual({ kind: 'end' });
  });

  it('stays inside a box narrower than its insets', () => {
    expect(caretTarget(10, 5.5, { left: 5, right: 6, top: 5, bottom: 6 })).toEqual({
      kind: 'point',
      x: 6,
      y: 6,
    });
  });
});
