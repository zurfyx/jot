import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PAGE_HEADS } from '../src/client/heads';
import { CARD_HEIGHT, CARD_KEYWORD, CARD_WIDTH, cardFile, cardHash, readPng } from './og';

describe('the link-preview cards (D31)', () => {
  it('give every public page its own image', () => {
    const images = PAGE_HEADS.map((head) => head.image);
    expect(new Set(images).size).toBe(images.length);
  });

  for (const head of PAGE_HEADS) {
    it(`are drawn, at 1200×630, from ${head.path} as it is now (else: pnpm og-images)`, () => {
      const file = cardFile(head.image);
      expect(existsSync(file), head.image).toBe(true);
      const png = readPng(readFileSync(file));
      expect([png.width, png.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
      expect(png.text.get(CARD_KEYWORD), head.image).toBe(cardHash(head));
    });
  }
});
