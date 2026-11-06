#!/usr/bin/env node
// Points every lexical and @lexical/* dependency at one Lexical build (D04):
// a meta/lexical commit published on pkg.pr.new, or an exact npm version (a
// release or a nightly).
//
//   node scripts/bump-lexical.mjs <pr-number | commit-sha>
//   node scripts/bump-lexical.mjs <npm-version> <commit-sha>
//
// A PR number resolves to that PR's current head commit. An npm version
// names the meta/lexical commit it was built from (a nightly's `main` commit),
// which package.json keeps as `lexicalCommit` for the docs' source links. The script rewrites
// package.json and the overrides in pnpm-workspace.yaml together, checks that
// pkg.pr.new serves the commit (or npm the version), and leaves
// `pnpm install` to you.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'meta/lexical';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['package.json', 'pnpm-workspace.yaml'];
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Every Lexical entry, whatever it points at: `"name": "spec"` in
// package.json, `'name': spec` in pnpm-workspace.yaml.
const ENTRY_PATTERNS = [
  /("(lexical|@lexical\/[a-z0-9-]+)":\s*")[^"]+(")/g,
  /^(\s*'(lexical|@lexical\/[a-z0-9-]+)':\s*)\S+()$/gm,
];

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
  fail(
    'usage: node scripts/bump-lexical.mjs <pr-number | commit-sha>, or <npm-version> <commit-sha>',
  );
}
let specOf;
let pinned;
let commit;
if (VERSION.test(arg)) {
  let published = '';
  try {
    published = run('npm', ['view', `lexical@${arg}`, 'version']).trim();
  } catch {
    // reported below
  }
  if (published !== arg) {
    fail(`npm has no lexical@${arg}`);
  }
  if (process.argv[3] === undefined) {
    fail(`name the meta/lexical commit ${arg} was built from: <npm-version> <commit-sha>`);
  }
  commit = resolveSha(process.argv[3]);
  specOf = () => arg;
  pinned = `npm ${arg}`;
} else {
  const sha = resolveSha(arg);
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    fail(`could not resolve "${arg}" to a commit of ${REPO}`);
  }
  const probe = `https://pkg.pr.new/${REPO}/lexical@${sha}`;
  const status = run('curl', ['-sSL', '-o', '/dev/null', '-w', '%{http_code}', probe]).trim();
  if (status !== '200') {
    fail(`pkg.pr.new has no build for ${sha} (${status} from ${probe})`);
  }
  commit = sha;
  specOf = (name) => `https://pkg.pr.new/${REPO}/${name}@${sha}`;
  pinned = sha;
}

let total = 0;
for (const file of FILES) {
  const path = join(ROOT, file);
  let count = 0;
  let after = readFileSync(path, 'utf8');
  for (const pattern of ENTRY_PATTERNS) {
    after = after.replace(pattern, (_match, head, name, tail) => {
      count++;
      return `${head}${specOf(name)}${tail}`;
    });
  }
  if (count === 0) {
    fail(`no Lexical entries found in ${file}`);
  }
  if (file === 'package.json') {
    after = after.replace(/("lexicalCommit":\s*")[0-9a-f]{40}(")/, `$1${commit}$2`);
  }
  writeFileSync(path, after);
  total += count;
  console.log(`${file}: ${count} entries`);
}

console.log(`Pinned ${total} Lexical entries to ${pinned}.`);
console.log('Next: pnpm install, then `pnpm why lexical` must show one version.');
