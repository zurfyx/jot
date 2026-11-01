import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { SITE_URL } from '../shared/site';

/**
 * robots.txt and the sitemap by host (D32): production names its sitemap; a
 * branch Preview on workers.dev keeps the same rules, names no sitemap and has
 * none. (Production's sitemap itself is a built file: e2e/production checks it.)
 */

const PRODUCTION = 'https://jot.rovira.sh';
const PREVIEW = 'https://feat-discoverability-jot.rovira.workers.dev';
const RULES = ['User-agent: *', 'Disallow: /n/', 'Disallow: /api/', 'Disallow: /new'];

describe('robots.txt and the sitemap', () => {
  it('in production: the rules, then the sitemap', async () => {
    const response = await exports.default.fetch(`${PRODUCTION}/robots.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(`${RULES.join('\n')}\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  });

  it('on a Preview: the same rules and no sitemap, which it does not have either', async () => {
    const robots = await exports.default.fetch(`${PREVIEW}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toBe(`${RULES.join('\n')}\n`);
    const sitemap = await exports.default.fetch(`${PREVIEW}/sitemap.xml`);
    expect(sitemap.status).toBe(404);
    await sitemap.body?.cancel();
  });

  it('the rules keep notes, the API and the links that create notes out of crawlers', async () => {
    const text = await (await exports.default.fetch(`${PRODUCTION}/robots.txt`)).text();
    for (const path of ['/n/', '/api/', '/new']) {
      expect(text.split('\n')).toContain(`Disallow: ${path}`);
    }
    expect(text).not.toMatch(/^Disallow: \/$/m);
  });
});
