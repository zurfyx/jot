import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import { build } from 'vite';

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
const CLIENT = join(ROOT, 'dist/client');
const SERVER = join(ROOT, 'node_modules/.cache/jot-prerender');

/** Only what scripts/prerender.ts reads of src/client/heads.ts and site.ts. */
interface PageHead {
  path: string;
  title: string;
  description: string;
  image: string;
  type: 'website' | 'article';
}

interface Prerender {
  renderPage(path: string): Promise<string>;
  PAGE_HEADS: readonly PageHead[];
  LANDING_HEAD: PageHead;
  NOT_FOUND_TITLE: string;
  SITE_NAME: string;
  siteUrl(path: string): string;
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
      ssr: 'src/client/prerender.tsx',
      outDir: SERVER,
      emptyOutDir: true,
      minify: false,
    },
  });
  const app = (await import(pathToFileURL(join(SERVER, 'prerender.js')).href)) as Prerender;

  const template = await readFile(join(CLIENT, 'index.html'), 'utf8');
  if (!template.includes('<div id="root"></div>')) {
    throw new Error('prerender: dist/client/index.html is not the built shell; run `pnpm build`.');
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

  for (const head of app.PAGE_HEADS) {
    const url = app.siteUrl(head.path);
    const image = app.siteUrl(head.image);
    const structured =
      head.path === '/'
        ? {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: app.SITE_NAME,
            url,
            description: head.description,
          }
        : {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: head.title,
            description: head.description,
            url,
            inLanguage: 'en',
            isPartOf: { '@type': 'WebSite', name: app.SITE_NAME, url: app.siteUrl('/') },
          };
    const meta = [
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:type" content="${head.type}" />`,
      `<meta property="og:site_name" content="${app.SITE_NAME}" />`,
      `<meta property="og:title" content="${escapeHtml(head.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(head.description)}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${image}" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:title" content="${escapeHtml(head.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(head.description)}" />`,
      `<meta name="twitter:image" content="${image}" />`,
      `<script type="application/ld+json">${scriptJson(structured)}</script>`,
      fontPreload,
    ].join('\n    ');
    const links = head.path === '/' ? '' : docsLinks;
    const body = await app.renderPage(head.path);
    const file = head.path === '/' ? 'index.html' : `${head.path.slice(1)}/index.html`;
    files.push([
      file,
      page({ title: head.title, description: head.description, meta, links, body }),
    ]);
  }

  files.push([
    '404.html',
    page({
      title: app.NOT_FOUND_TITLE,
      meta: ['<meta name="robots" content="noindex" />', fontPreload].join('\n    '),
      links: '',
      body: await app.renderPage('/404'),
    }),
  ]);
  // The note page's shell, exactly as Vite built it.
  files.push(['n/shell.html', template]);

  for (const [file, html] of files) {
    const path = join(CLIENT, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html);
  }
  if (existsSync(SERVER)) {
    await rm(SERVER, { recursive: true, force: true });
  }
  console.log(`prerender: ${files.map(([file]) => file).join(', ')}`);
}

await main();
