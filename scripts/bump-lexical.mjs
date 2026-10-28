#!/usr/bin/env node
// Points every lexical and @lexical/* dependency at one meta/lexical
// commit published on pkg.pr.new (D04).
//
//   node scripts/bump-lexical.mjs <pr-number | commit-sha>
//
// A PR number resolves to that PR's current head commit. The script rewrites
// package.json and the overrides in pnpm-workspace.yaml together, checks
// that pkg.pr.new serves the commit, and leaves `pnpm install` to you.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'meta/lexical';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['package.json', 'pnpm-workspace.yaml'];
const URL_PATTERN =
  /https:\/\/pkg\.pr\.new\/(?:facebook|meta)\/lexical\/((?:@lexical\/)?[a-z0-9-]+)@[0-9a-f]{7,40}/g;

function fail(message) {
  console.error(`bump-lexical: ${message}`);
  process.exit(1);
}

// gh when it is logged in, curl otherwise. Both honour proxy settings, which
// Node's fetch does not by default.
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function github(path) {
  for (const [command, args] of [
    ['gh', ['api', path]],
    ['curl', ['-fsSL', `https://api.github.com/${path}`]],
  ]) {
    try {
      return JSON.parse(run(command, args));
    } catch {
      // try the next way
    }
  }
  fail(`could not read ${path} from GitHub`);
}

function resolveSha(arg) {
  if (/^\d+$/.test(arg)) {
    return github(`repos/${REPO}/pulls/${arg}`).head.sha;
  }
  if (/^[0-9a-f]{7,40}$/.test(arg)) {
    return github(`repos/${REPO}/commits/${arg}`).sha;
  }
  fail(`expected a PR number or a commit sha, got "${arg}"`);
}

const arg = process.argv[2];
if (arg === undefined) {
  fail('usage: node scripts/bump-lexical.mjs <pr-number | commit-sha>');
}
const sha = resolveSha(arg);
if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
  fail(`could not resolve "${arg}" to a commit of ${REPO}`);
}

const probe = `https://pkg.pr.new/${REPO}/lexical@${sha}`;
const status = run('curl', ['-sSL', '-o', '/dev/null', '-w', '%{http_code}', probe]).trim();
if (status !== '200') {
  fail(`pkg.pr.new has no build for ${sha} (${status} from ${probe})`);
}

let total = 0;
for (const file of FILES) {
  const path = join(ROOT, file);
  let count = 0;
  const after = readFileSync(path, 'utf8').replace(URL_PATTERN, (_match, name) => {
    count++;
    return `https://pkg.pr.new/${REPO}/${name}@${sha}`;
  });
  if (count === 0) {
    fail(`no pkg.pr.new Lexical URLs found in ${file}`);
  }
  writeFileSync(path, after);
  total += count;
  console.log(`${file}: ${count} URLs`);
}

console.log(`Pinned ${total} Lexical URLs to ${sha}.`);
console.log('Next: pnpm install, then `pnpm why lexical` must show one version.');
