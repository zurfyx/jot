import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The `e2e` job is the required check; it stands for the three e2e shards.
 * A required check that ends up skipped counts as passing, so the job must
 * run even when the run is cancelled, and fail unless every shard passed.
 */
const workflow = readFileSync(join(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe('the e2e check', () => {
  const e2e = job('e2e');

  it('waits for the shards and runs whatever happened to them', () => {
    expect(e2e).toMatch(/\n {4}needs: e2e-shard\n/);
    expect(e2e).toMatch(/\n {4}if: \$\{\{ always\(\) \}\}\n/);
  });

  it('passes only when the shards succeeded', () => {
    const run = /- run: (.+)\n/.exec(e2e)?.[1];
    expect(run).toBe('test "$SHARDS" = success');
    expect(e2e).toContain('SHARDS: ${{ needs.e2e-shard.result }}');
    const passes = (result: string) => {
      try {
        execFileSync('sh', ['-c', run!], { env: { SHARDS: result } });
        return true;
      } catch {
        return false;
      }
    };
    expect(passes('success')).toBe(true);
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      expect(passes(result)).toBe(false);
    }
  });
});
