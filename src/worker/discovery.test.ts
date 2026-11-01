import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { SITE_URL } from '../shared/site';
import worker from './index';

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
    // Its sitemap is the 404 page, as any unknown path's is. The test Worker
    // has no assets: these stand in for the built ones.
    const asked: string[] = [];
    const assets = {
      fetch: (request: Request) => {
        asked.push(new URL(request.url).pathname);
        return Promise.resolve(
          new Response('<h1>This page doesn&#x27;t exist.</h1>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        );
      },
    } as unknown as Fetcher;
    const sitemap = await worker.fetch!(
      new Request(`${PREVIEW}/sitemap.xml`) as Parameters<NonNullable<typeof worker.fetch>>[0],
      { ...env, ASSETS: assets },
    );
    expect(sitemap.status).toBe(404);
    expect(sitemap.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await sitemap.text()).toContain('This page doesn&#x27;t exist.');
    expect(asked).toEqual(['/404']);
  });

  it('the rules keep notes, the API and the links that create notes out of crawlers', async () => {
    const text = await (await exports.default.fetch(`${PRODUCTION}/robots.txt`)).text();
    for (const path of ['/n/', '/api/', '/new']) {
      expect(text.split('\n')).toContain(`Disallow: ${path}`);
    }
    expect(text).not.toMatch(/^Disallow: \/$/m);
  });
});
