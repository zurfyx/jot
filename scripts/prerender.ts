import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import { build } from 'vite';

import {
  type DocsEntry,
  llmsFullTxt,
  llmsTxt,
  markdownPath,
  robotsTxt,
  sitemapXml,
} from './discovery.ts';
import { htmlToMarkdown } from './markdown.ts';
import { stylex } from './vite-stylex.ts';

/**
 * Prerenders jot's public pages into the client build (D31), after
 * `vite build`: the landing page, every docs page and the 404 page, each with
 * its own head (title, description, canonical, Open Graph, structured data).
 * A note's page stays client-only: its shell is the built index.html as it
 * was, kept as n/shell.html for the Worker to serve.
 *
 * The app is rendered by a server build of src/client/prerender.tsx (Vite's
 * SSR build, with the same StyleX plugin, so the same class names), with
 * React's `prerender`, in Node.
 */

const ROOT = join(import.meta.dirname, '..');

/** `--name=value` from the command line, or `fallback`. */
function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

/** The app's prerender entry; scripts/prerender.test.ts passes one that fails. */
const ENTRY = option('entry', 'src/client/prerender.tsx');
/** The client build to prerender into. */
const CLIENT = resolve(ROOT, option('client', 'dist/client'));
const SERVER = join(ROOT, `node_modules/.cache/jot-prerender-${process.pid}`);

/** React leaves this where a Suspense boundary failed on the server, for the browser to render. */
const CLIENT_FALLBACK = '<!--$!-->';

/** Only what scripts/prerender.ts reads of src/client/heads.ts, site.ts and head.ts. */
interface PageHead {
  path: string;
  title: string;
  description: string;
  card: { heading: string };
}

interface HeadTags {
  canonical: string;
  meta: { attr: 'name' | 'property'; key: string; content: string }[];
  structured: Record<string, unknown>;
}

interface Prerender {
  renderPage(path: string): Promise<string>;
  renderNoScriptNotice(): Promise<string>;
  headTags(head: PageHead): HeadTags;
  PAGE_HEADS: readonly PageHead[];
  LANDING_HEAD: PageHead;
  NOT_FOUND_TITLE: string;
  DOCS_PAGES: readonly { slug: string; title: string; blurb: string; group: string }[];
  DOCS_GROUPS: readonly string[];
  docsPath(slug: string): string;
  SITE_NAME: string;
  siteUrl(path: string): string;
}

/** A root's text, tags dropped and entities read, for checking what a page says. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fails unless a rendered root has what its page must say, and no boundary
 * left for the browser to render.
 */
function checkRoot(page: string, html: string, expected: string): void {
  if (html.includes(CLIENT_FALLBACK)) {
    throw new Error(`prerender: ${page} has a part React left for the browser to render.`);
  }
  if (!textOf(html).includes(expected)) {
    throw new Error(`prerender: ${page} does not say "${expected}".`);
  }
}

interface ManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON inside a <script>: nothing in it can close the element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** A chunk's JS and CSS, with everything it imports statically, but for what `skip` says. */
function closure(
  manifest: Record<string, ManifestChunk>,
  key: string,
  skip: (file: string) => boolean,
) {
  const js = new Set<string>();
  const css = new Set<string>();
  const visit = (name: string) => {
    const chunk = manifest[name];
    if (chunk === undefined || js.has(chunk.file)) {
      return;
    }
    js.add(chunk.file);
    chunk.css?.forEach((file) => css.add(file));
    chunk.imports?.forEach(visit);
  };
  visit(key);
  return { js: [...js].filter((file) => !skip(file)), css: [...css].filter((file) => !skip(file)) };
}

/**
 * The dark token sets for a browser with no script: index.html's pre-paint
 * script sets `data-theme`, and without it the system's setting decides.
 * Drawn from globals.css, so there is one copy of every value.
 */
async function noScriptDark(): Promise<string> {
  const globals = (await readFile(join(ROOT, 'src/client/globals.css'), 'utf8')).replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  // The top-level rules (depth 0) whose selector names the dark theme.
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let i = 0; i < globals.length; i++) {
    if (globals[i] === '{') {
      if (depth === 0) {
        prelude = globals.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (globals[i] === '}') {
      depth--;
      if (depth === 0) {
        const body = globals.slice(start, i).replace(/\s+/g, ' ').trim();
        if (prelude.includes("[data-theme='dark']")) {
          const selector = prelude
            .split(/,\s*/)
            .map((part) =>
              part
                .replace(":root[data-theme='dark']", ':root:not([data-theme])')
                .replace(/^\[data-theme='dark'\]/, ':root:not([data-theme])'),
            )
            .join(',');
          rules.push(`${selector}{${body}}`);
        }
        start = i + 1;
      }
    }
  }
  return `<noscript><style>@media (prefers-color-scheme: dark){${rules.join('')}}</style></noscript>`;
}

async function main(): Promise<void> {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    plugins: [stylex({ rootDir: ROOT }), react()],
    build: {
      ssr: ENTRY,
      rolldownOptions: {
        output: { entryFileNames: 'prerender.js' },
        // One file: a module the browser loads on demand is simply in it.
        onLog(level, log, handler) {
          if (log.code !== 'INEFFECTIVE_DYNAMIC_IMPORT') {
            handler(level, log);
          }
        },
      },
      outDir: SERVER,
      emptyOutDir: true,
      minify: false,
    },
  });
  const app = (await import(pathToFileURL(join(SERVER, 'prerender.js')).href)) as Prerender;

  const template = await readFile(join(CLIENT, 'index.html'), 'utf8');
  if (!template.includes('<div id="root"></div>')) {
    throw new Error(`prerender: ${CLIENT}/index.html is not the built shell; run \`pnpm build\`.`);
  }
  const manifestFile = join(CLIENT, '.vite/manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<
    string,
    ManifestChunk
  >;
  // The manifest is the build's own record; it is not served.
  await rm(join(CLIENT, '.vite'), { recursive: true, force: true });

  const font = (await readdir(join(CLIENT, 'assets'))).find((file) =>
    /^geist-latin-wght-normal-[\w-]+\.woff2$/.test(file),
  );
  if (font === undefined) {
    throw new Error('prerender: the build has no Geist latin font to preload.');
  }
  // A lazy page's chunk and stylesheet, for the pages that show it: what
  // the entry already loads (index.html links it) is not repeated.
  const lazyPage = (key: string) => {
    const chunk = closure(manifest, key, (file) => template.includes(`/${file}"`));
    if (chunk.js.length === 0 || chunk.css.length === 0) {
      throw new Error(`prerender: the build's manifest has no chunk for ${key}.`);
    }
    // It needs its chunk to hydrate, and its stylesheet to paint: both load
    // with the page, after the entry's (D28's layer order).
    return [
      ...chunk.css.map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`),
      ...chunk.js.map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`),
    ].join('\n    ');
  };
  const docsLinks = lazyPage('src/client/docs/DocsPage.tsx');
  const noScript = await noScriptDark();

  /** The shell with `body` in its root and `head` in its head. */
  const page = (options: {
    title: string;
    description?: string;
    meta: string;
    links: string;
    body: string;
  }) => {
    let html = template
      .replace('<title>jot</title>', `<title>${escapeHtml(options.title)}</title>`)
      .replace('<div id="root"></div>', `<div id="root">${options.body}</div>`)
      .replace(
        '</head>',
        `${options.links === '' ? '' : `  ${options.links}\n`}    ${noScript}\n  </head>`,
      );
    const description = /<meta\s+name="description"\s+content="[^"]*"\s*\/>/;
    if (!description.test(html)) {
      throw new Error('prerender: index.html has no description to replace.');
    }
    html = html.replace(
      description,
      `<meta name="description" content="${escapeHtml(options.description ?? app.LANDING_HEAD.description)}" />\n    ${options.meta}`,
    );
    return html;
  };

  const fontPreload = `<link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />`;
  const files: [string, string][] = [];
  /** Each public page's rendered root, for the Markdown copies. */
  const bodies = new Map<string, string>();

  for (const head of app.PAGE_HEADS) {
    const tags = app.headTags(head);
    const meta = [
      `<link rel="canonical" href="${tags.canonical}" />`,
      ...tags.meta.map(
        ({ attr, key, content }) => `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`,
      ),
      `<script type="application/ld+json">${scriptJson(tags.structured)}</script>`,
      fontPreload,
    ].join('\n    ');
    const links = head.path === '/' ? '' : docsLinks;
    const body = await app.renderPage(head.path);
    checkRoot(head.path, body, head.card.heading);
    bodies.set(head.path, body);
    const file = head.path === '/' ? 'index.html' : `${head.path.slice(1)}/index.html`;
    files.push([
      file,
      page({ title: head.title, description: head.description, meta, links, body }),
    ]);
  }

  const notFound = await app.renderPage('/404');
  checkRoot('404.html', notFound, "This page doesn't exist.");
  files.push([
    '404.html',
    page({
      title: app.NOT_FOUND_TITLE,
      meta: ['<meta name="robots" content="noindex" />', fontPreload].join('\n    '),
      links: '',
      body: notFound,
    }),
  ]);
  // The note page's shell, as Vite built it, with what it shows when scripts
  // are off (notes need them) and the dark token sets for that case.
  const notice = await app.renderNoScriptNotice();
  checkRoot('n/shell.html', notice, 'jot needs JavaScript to edit notes.');
  files.push([
    'n/shell.html',
    template
      .replace('</head>', `  ${noScript}\n  </head>`)
      .replace('<div id="root"></div>', `<noscript>${notice}</noscript><div id="root"></div>`),
  ]);

  // What crawlers and assistants read (D32): robots.txt and the sitemap, and
  // every docs page as Markdown, converted from its prerendered article, with
  // the index and the full text. Static, the same on every host.
  const site = { name: app.SITE_NAME, summary: app.LANDING_HEAD.description, url: app.siteUrl };
  files.push(['robots.txt', robotsTxt(app.siteUrl('/sitemap.xml'))]);
  files.push([
    'sitemap.xml',
    sitemapXml(app.PAGE_HEADS.map((head) => app.headTags(head).canonical)),
  ]);
  const docs: { page: DocsEntry; markdown: string }[] = app.DOCS_PAGES.map((entry) => {
    const page = {
      path: app.docsPath(entry.slug),
      title: entry.title,
      description: entry.blurb,
      group: entry.group,
    };
    const body = bodies.get(page.path);
    if (body === undefined) {
      throw new Error(`prerender: ${page.path} has no head to render it with.`);
    }
    const markdown = htmlToMarkdown(body, (element) => element.tag === 'article', {
      base: app.siteUrl('/'),
    });
    if (!markdown.includes(`# ${entry.title}`) && entry.slug !== '') {
      throw new Error(`prerender: ${page.path}'s Markdown has no "# ${entry.title}".`);
    }
    files.push([markdownPath(page.path).slice(1), markdown]);
    return { page, markdown };
  });
  files.push([
    'llms.txt',
    llmsTxt(
      site,
      docs.map(({ page }) => page),
      app.DOCS_GROUPS,
    ),
  ]);
  files.push(['llms-full.txt', llmsFullTxt(site, docs)]);

  for (const [file, html] of files) {
    const path = join(CLIENT, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html);
  }
  // Their types, in UTF-8, named file by file: a pattern would also give an
  // unknown path's 404 page (HTML) the Markdown type.
  const types = files.flatMap(([file]) => {
    const type = file.endsWith('.md')
      ? 'text/markdown'
      : file.endsWith('.txt')
        ? 'text/plain'
        : file.endsWith('.xml')
          ? 'application/xml'
          : null;
    return type === null ? [] : [`/${file}\n  Content-Type: ${type}; charset=utf-8`];
  });
  const headersFile = join(CLIENT, '_headers');
  const headers = existsSync(headersFile) ? await readFile(headersFile, 'utf8') : '';
  await writeFile(
    headersFile,
    `${headers.trimEnd()}\n\n# What assistants read (D32), written by scripts/prerender.ts.\n${types.join('\n')}\n`,
  );
  console.log(`prerender: ${files.map(([file]) => file).join(', ')}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (existsSync(SERVER)) {
    await rm(SERVER, { recursive: true, force: true });
  }
}
