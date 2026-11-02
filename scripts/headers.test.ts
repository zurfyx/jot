import { describe, expect, it } from 'vitest';

import { countRules, headerRules, IMMUTABLE, isHashed, MAX_RULES, textType } from './headers';

/** The `_headers` rules the build writes (D32, D33). */

describe('the build’s _headers rules', () => {
  it('tell a content-hashed name from any other', () => {
    expect(isHashed('index-nHemqc7Q.js')).toBe(true);
    expect(isHashed('geist-latin-wght-normal-BgDaEnEv.woff2')).toBe(true);
    expect(isHashed('DocsPage-HPGpb-yZ.js')).toBe(true);
    expect(isHashed('webllm-worker-C0Cklaie.js')).toBe(true);
    expect(isHashed('index.js')).toBe(false);
    expect(isHashed('favicon.svg')).toBe(false);
    expect(isHashed('logo-v2.png')).toBe(false);
  });

  it('give each text file its type, and each hashed asset a year, file by file', () => {
    const rules = headerRules(
      ['index.html', 'robots.txt', 'sitemap.xml', 'docs/blame.md', 'llms.txt'],
      ['index-nHemqc7Q.js', 'index-6izbEPsu.css', 'plain.js'],
    );
    expect(rules).toContain('/robots.txt\n  Content-Type: text/plain; charset=utf-8');
    expect(rules).toContain('/sitemap.xml\n  Content-Type: application/xml; charset=utf-8');
    expect(rules).toContain('/docs/blame.md\n  Content-Type: text/markdown; charset=utf-8');
    expect(rules).toContain(`/assets/index-nHemqc7Q.js\n  Cache-Control: ${IMMUTABLE}`);
    expect(rules).toContain(`/assets/index-6izbEPsu.css\n  Cache-Control: ${IMMUTABLE}`);
    // No pattern, no HTML, and nothing for a name without a hash.
    const text = rules.join('\n');
    expect(text).not.toContain('*');
    expect(text).not.toContain('index.html');
    expect(text).not.toContain('plain.js');
    expect(countRules(text)).toBe(6);
  });

  it('cache for a year without revalidating', () => {
    expect(IMMUTABLE).toBe('public, max-age=31536000, immutable');
    expect(textType('a.md')).toBe('text/markdown');
    expect(textType('a.png')).toBeNull();
  });

  it('count rules as Cloudflare does: one per path', () => {
    expect(countRules('# a comment\n/a\n  X: 1\n  Y: 2\n/b/*\n  Z: 3\n')).toBe(2);
    expect(MAX_RULES).toBe(100);
  });
});
