import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

/**
 * The link-preview cards (D31): one 1200×630 PNG per public page, drawn from
 * its head (src/client/heads.ts) with jot's own tokens and Geist, and
 * committed under public/og/. `pnpm og-images` draws them
 * (scripts/og-images.ts); each PNG carries the hash of the card it was drawn
 * from, so a test (scripts/og.test.ts) fails when one is missing or stale.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** The PNG text chunk that holds a card's hash. */
export const CARD_KEYWORD = 'jot:card';

const ROOT = join(import.meta.dirname, '..');

/** What a card shows: src/client/site.ts's PageHead, in part. */
export interface CardHead {
  path: string;
  description: string;
  card: { kicker: string; heading: string };
  tint: 'you' | 'ana' | 'ai';
}

/** The light colour tokens, read from tokens.stylex.ts (no copy of any value). */
function tokens(): Record<string, string> {
  const source = readFileSync(join(ROOT, 'src/client/theme/tokens.stylex.ts'), 'utf8');
  const block = /export const colors = stylex\.defineVars\(\{([\s\S]*?)\n\}\);/.exec(source)?.[1];
  if (block === undefined) {
    throw new Error('og: tokens.stylex.ts has no colors.');
  }
  return Object.fromEntries(
    [...block.matchAll(/^\s*'(--[\w-]+)':\s*'([^']+)'/gm)].map(([, name, value]) => [
      name!,
      value!,
    ]),
  );
}

const TINT_TOKEN = { you: '--peer-0', ana: '--peer-1', ai: '--peer-2' } as const;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A card's HTML, with `FONT_URL` where Geist goes: the jot wordmark (and
 * "docs" for a docs page), the heading, the description, and the page's dot
 * and address at the foot.
 */
export function cardHtml(head: CardHead): string {
  const color = tokens();
  const [brand, sub] = head.card.kicker.split(' ');
  const address = `jot.rovira.sh${head.path === '/' ? '' : head.path}`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url(FONT_URL) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; }
body { display: flex; flex-direction: column; padding: 72px 88px; background: ${color['--bg']};
  color: ${color['--ink']}; font-family: Geist, sans-serif; border-top: 10px solid ${color['--peer-2']}; }
.brand { font-size: 40px; font-weight: 700; letter-spacing: -0.01em; }
.brand em { margin-left: 10px; color: ${color['--muted']}; font-style: normal; font-weight: 500; }
.caret { display: inline-block; width: 4px; height: 38px; margin-left: 5px; vertical-align: -6px;
  background: ${color['--peer-2']}; }
h1 { margin-top: auto; max-width: 980px; font-size: 76px; line-height: 1.08; font-weight: 680;
  letter-spacing: -0.03em; }
p { margin-top: 26px; max-width: 960px; color: ${color['--body']}; font-size: 31px; line-height: 1.4; }
.foot { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 30px;
  border-top: 2px solid ${color['--rule']}; color: ${color['--muted']}; font-size: 24px; font-weight: 500; }
.dot { width: 16px; height: 16px; border-radius: 4px; background: ${color[TINT_TOKEN[head.tint]]}; }
</style></head><body>
<div class="brand">${escapeHtml(brand ?? 'jot')}${sub === undefined ? '<span class="caret"></span>' : `<em>${escapeHtml(sub)}</em>`}</div>
<h1>${escapeHtml(head.card.heading)}</h1>
<p>${escapeHtml(head.description)}</p>
<div class="foot"><i class="dot"></i>${escapeHtml(address)}</div>
</body></html>`;
}

/** The hash a card's PNG carries: of its HTML, so any change to it shows. */
export function cardHash(head: CardHead): string {
  return createHash('sha256').update(cardHtml(head)).digest('hex').slice(0, 32);
}

/** The PNG with a text chunk `keyword` = `text`, just before its end. */
export function withTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text)]);
  const type = Buffer.from('tEXt', 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const end = png.length - 12; // the IEND chunk
  return Buffer.concat([png.subarray(0, end), length, type, data, crc, png.subarray(end)]);
}

/** A PNG's size and text chunks. */
export function readPng(png: Buffer): { width: number; height: number; text: Map<string, string> } {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('og: not a PNG.');
  }
  const text = new Map<string, string>();
  let width = 0;
  let height = 0;
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'tEXt') {
      const split = data.indexOf(0);
      text.set(data.toString('latin1', 0, split), data.toString('utf8', split + 1));
    }
    at += 12 + length;
  }
  return { width, height, text };
}

/** Where a page's card lives in the repository: public/og/<name>.png. */
export function cardFile(image: string): string {
  return join(ROOT, 'public', image);
}
