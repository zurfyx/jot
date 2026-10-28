/**
 * Every code block the docs show, from real files: the snippets under
 * src/docs/snippets/ (type-checked with the app) and excerpts of jot's own
 * source. Imported as raw text, so a page can't drift from compiling code.
 */

import aiPeer from '../../docs/snippets/ai-peer.ts?raw';
import inspect from '../../docs/snippets/inspect.ts?raw';
import merge from '../../docs/snippets/merge.ts?raw';
import presence from '../../docs/snippets/presence.ts?raw';
import prompt from '../../docs/snippets/prompt.ts?raw';
import quickStart from '../../docs/snippets/quick-start.ts?raw';
import reconnect from '../../docs/snippets/reconnect.ts?raw';
import registry from '../../docs/snippets/registry.ts?raw';
import serverEdit from '../../docs/snippets/server-edit.ts?raw';
import underline from '../../docs/snippets/underline.ts?raw';
import webllmWorker from '../../docs/snippets/webllm-worker.ts?raw';
import workOffline from '../../docs/snippets/work-offline.ts?raw';
import aiMarkdownSource from '../editor/ai/markdown.ts?raw';
import attributionSource from '../editor/blame/attribution.ts?raw';
import limitsSource from '../../shared/limits.ts?raw';
import roomSource from '../../worker/room.ts?raw';
import pkg from '../../../package.json';
import { excerpt } from './excerpt';

export const REPO_URL = 'https://github.com/zurfyx/jot';
/** The Lexical commit jot pins (D04), from package.json. */
export const LEXICAL_SHA = /@([0-9a-f]{40})$/.exec(pkg.dependencies['@lexical/y'])?.[1] ?? 'main';
const LEXICAL_Y_TREE = `https://github.com/meta/lexical/tree/${LEXICAL_SHA}/packages/lexical-y`;
const LEXICAL_Y_BLOB = `https://github.com/meta/lexical/blob/${LEXICAL_SHA}/packages/lexical-y`;
/** `@lexical/y`'s README at that commit: setup, storage and the wire format. */
export const LEXICAL_Y_README = `${LEXICAL_Y_BLOB}/README.md`;
export const LEXICAL_Y_WIRE_FORMAT = `${LEXICAL_Y_README}#wire-format-layout-1`;
/** The binding's source at that commit: its exports are the API. */
export const LEXICAL_Y_SOURCE = `${LEXICAL_Y_TREE}/src`;
export const LEXICAL_Y_HEADLESS = `${LEXICAL_Y_BLOB}/src/headless.ts`;
export const YJS_URL = 'https://github.com/yjs/yjs';

export function sourceUrl(path: string, lines?: [number, number]): string {
  const anchor = lines === undefined ? '' : `#L${lines[0]}-L${lines[1]}`;
  return `${REPO_URL}/blob/main/${path}${anchor}`;
}

export interface CodeSource {
  /** The file name shown above the code. */
  file: string;
  code: string;
  /** Where the code lives on GitHub; absent for shell commands. */
  href?: string;
  language: 'ts' | 'shell';
}

function snippet(name: string, raw: string): CodeSource {
  const path = `src/docs/snippets/${name}`;
  return { file: name, code: raw.trimEnd(), href: sourceUrl(path), language: 'ts' };
}

function from(path: string, raw: string, start: string, label = path): CodeSource {
  const cut = excerpt(raw, start);
  return {
    file: label,
    code: cut.code,
    href: sourceUrl(path, [cut.startLine, cut.endLine]),
    language: 'ts',
  };
}

/**
 * What jot itself installs: every Lexical package from the same pkg.pr.new
 * build (D04), and the pinned Yjs 14 release candidate.
 */
function installCommand(): string {
  const deps: Record<string, string> = pkg.dependencies;
  const lexical = ['lexical', '@lexical/extension', '@lexical/rich-text', '@lexical/y'];
  const packages = [
    ...lexical.map((name) => deps[name] ?? name),
    `@y/y@${deps['@y/y']}`,
    `@y/websocket@${deps['@y/websocket']}`,
  ];
  return ['pnpm add', ...packages.map((spec) => `  ${spec}`)].join(' \\\n');
}

export const SNIPPETS = {
  quickStart: snippet('quick-start.ts', quickStart),
  inspect: snippet('inspect.ts', inspect),
  presence: snippet('presence.ts', presence),
  merge: snippet('merge.ts', merge),
  reconnect: snippet('reconnect.ts', reconnect),
  workOffline: snippet('work-offline.ts', workOffline),
  registry: snippet('registry.ts', registry),
  underline: snippet('underline.ts', underline),
  aiPeer: snippet('ai-peer.ts', aiPeer),
  prompt: snippet('prompt.ts', prompt),
  webllmWorker: snippet('webllm-worker.ts', webllmWorker),
  serverEdit: snippet('server-edit.ts', serverEdit),
  install: {
    file: 'Terminal',
    code: installCommand(),
    language: 'shell',
  },
  roomFetch: from('src/worker/room.ts', roomSource, 'async fetch('),
  roomUpdate: from('src/worker/room.ts', roomSource, 'private receiveUpdate('),
  roomSave: from('src/worker/room.ts', roomSource, 'save(): void'),
  contentMap: from(
    'src/client/editor/blame/attribution.ts',
    attributionSource,
    'export function buildContentMap(',
  ),
  computeBlame: from(
    'src/client/editor/blame/attribution.ts',
    attributionSource,
    'export function computeBlame(',
  ),
  cleanReply: from(
    'src/client/editor/ai/markdown.ts',
    aiMarkdownSource,
    'export function cleanReply(',
  ),
  snapshotBlocks: from(
    'src/client/editor/ai/markdown.ts',
    aiMarkdownSource,
    'export function $snapshotBlocks(',
  ),
  fitsUnderCap: from('src/shared/limits.ts', limitsSource, 'export function fitsUnderCap('),
} satisfies Record<string, CodeSource>;
