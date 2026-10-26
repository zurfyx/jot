import { describe, expect, it } from 'vitest';

import { normalizeLinkUrl, parseNoteInput } from './links';

const ID = 'k3Jd9xQ2vL8a-_k3Jd9xQw';

describe('parseNoteInput', () => {
  it.each([
    [ID, ID],
    [`  ${ID}\n`, ID],
    ['public', 'public'],
    [`https://jot.rovira.sh/n/${ID}`, ID],
    [`https://jot.rovira.sh/n/${ID}/`, ID],
    [`https://jot.rovira.sh/n/${ID}?ref=chat#top`, ID],
    [`jot.rovira.sh/n/${ID}`, ID],
    [`http://localhost:5173/n/${ID}`, ID],
    ['https://jot.rovira.sh/n/public', 'public'],
  ])('reads %j', (input, expected) => {
    expect(parseNoteInput(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'hello there',
    'k3Jd9x',
    `https://example.com/n/${ID}`,
    `https://jot.rovira.sh.evil.com/n/${ID}`,
    `https://jot.rovira.sh/x/${ID}`,
    `https://jot.rovira.sh/n/${ID}/extra`,
    'https://jot.rovira.sh/n/not-an-id',
    `javascript:alert(1)//jot.rovira.sh/n/${ID}`,
    `ftp://jot.rovira.sh/n/${ID}`,
  ])('rejects %j', (input) => {
    expect(parseNoteInput(input)).toBeNull();
  });

  it('accepts links from the current host', () => {
    expect(parseNoteInput(`https://preview.example.dev/n/${ID}`)).toBeNull();
    expect(parseNoteInput(`https://preview.example.dev/n/${ID}`, 'preview.example.dev')).toBe(ID);
  });
});

describe('normalizeLinkUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['https://lexical.dev/docs', 'https://lexical.dev/docs'],
    ['mailto:someone@example.com', 'mailto:someone@example.com'],
  ])('accepts %j', (input, expected) => {
    expect(normalizeLinkUrl(input)).toBe(expected);
  });

  it.each(['', '  ', 'javascript:alert(1)', 'data:text/html,hi'])('rejects %j', (input) => {
    expect(normalizeLinkUrl(input)).toBeNull();
  });
});
