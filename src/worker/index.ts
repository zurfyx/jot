import { isNoteId } from '../shared/ids';

import { NOTE_ID_HEADER } from './room';

export { NoteRoom } from './room';

const SOCKET_ROUTE = /^\/api\/n\/([^/]+)\/ws$/;
/**
 * Development and tests only (compiled out of production builds): give a
 * note a new incarnation and close its sockets, as a migration will, so the
 * end-to-end tests can move a note on while a page holds offline edits
 * (`?inherited=1`: as a note from before the fence).
 */
const TEST_REPLACE_ROUTE = /^\/api\/test\/n\/([^/]+)\/replace-incarnation$/;
/** Development and tests only: `?floor=` and `?maxBytes=` for one note (D34). */
const TEST_SETTINGS_ROUTE = /^\/api\/test\/n\/([^/]+)\/settings$/;
/** A note's offline-edit recovery (D34): uploads, the list, a record's source view and export. */
const RECOVERY_ROUTE = /^\/api\/n\/([^/]+)\/recovery(?:\/\d+\/(?:view|raw))?$/;
const NOTE_ROUTE = /^\/n\/([^/]+)\/?$/;
const NEW_ROUTE = /^\/new\/?$/;
/** The 404 page's own file, which the assets would otherwise serve with a 200. */
const NOT_FOUND_ROUTE = /^\/404(?:\.html)?$/;
/**
 * The note page's shell, the client-only document (scripts/prerender.ts,
 * D31). It sits under /n/, where a request for it is a malformed note link.
 */
const SHELL = '/n/shell';

/** Notes and the API stay out of search engines; the landing page does not (D17). */
const ROBOTS_HEADER = 'X-Robots-Tag';
const ROBOTS_VALUE = 'noindex, nofollow';

function isPrivatePath(pathname: string): boolean {
  return pathname.startsWith('/n/') || pathname.startsWith('/api/');
}

/** The same response with the robots header. Upstream headers can be immutable. */
function withNoIndex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(ROBOTS_HEADER, ROBOTS_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: response.webSocket,
  });
}

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const response = await route(request, env, url);
    return isPrivatePath(url.pathname) ? withNoIndex(response) : response;
  },
} satisfies ExportedHandler<Env>;

/**
 * The note page's shell: the client router renders the page. The dev server
 * prerenders nothing, and its index.html is the shell itself.
 */
async function shell(request: Request, env: Env, url: URL): Promise<Response> {
  const built = await env.ASSETS.fetch(new Request(new URL(SHELL, url), request));
  if (built.status !== 404) {
    return built;
  }
  await built.body?.cancel();
  return env.ASSETS.fetch(new Request(new URL('/', url), request));
}

/** The prerendered 404 page, with its status (D31), as the assets give any unknown path. */
async function notFoundPage(request: Request, env: Env, url: URL): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/404', url), request));
  return new Response(page.body, { status: 404, headers: page.headers });
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const socket = SOCKET_ROUTE.exec(url.pathname);
  if (socket !== null) {
    const id = socket[1] ?? '';
    if (!isNoteId(id)) {
      return badRequest('Not a note id.');
    }
    if (request.method !== 'GET' || request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const stub = env.NOTES.get(env.NOTES.idFromName(id));
    const headers = new Headers(request.headers);
    headers.set(NOTE_ID_HEADER, id);
    return stub.fetch(new Request(request, { headers }));
  }

  if (import.meta.env.DEV) {
    const replace = TEST_REPLACE_ROUTE.exec(url.pathname);
    if (replace !== null && request.method === 'POST' && isNoteId(replace[1] ?? '')) {
      const id = replace[1]!;
      await env.NOTES.get(env.NOTES.idFromName(id)).testReplaceIncarnation(
        url.searchParams.get('inherited') === '1',
      );
      return new Response('replaced');
    }
    const settings = TEST_SETTINGS_ROUTE.exec(url.pathname);
    if (settings !== null && request.method === 'POST' && isNoteId(settings[1] ?? '')) {
      const values: { floor?: number; maxBytes?: number } = {};
      for (const key of ['floor', 'maxBytes'] as const) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          values[key] = Number(value);
        }
      }
      await env.NOTES.get(env.NOTES.idFromName(settings[1]!)).testSettings(values);
      return new Response('set');
    }
  }

  const recovery = RECOVERY_ROUTE.exec(url.pathname);
  if (recovery !== null) {
    const id = recovery[1] ?? '';
    if (!isNoteId(id)) {
      return badRequest('Not a note id.');
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed.', { status: 405 });
    }
    const stub = env.NOTES.get(env.NOTES.idFromName(id));
    const headers = new Headers(request.headers);
    headers.set(NOTE_ID_HEADER, id);
    return stub.fetch(new Request(request, { headers }));
  }

  const note = NOTE_ROUTE.exec(url.pathname);
  if (note !== null) {
    if (!isNoteId(note[1] ?? '')) {
      return badRequest('Not a note link.');
    }
    return shell(request, env, url);
  }

  if (NEW_ROUTE.test(url.pathname)) {
    // A fresh note (D23) or the example: the client picks its id.
    return shell(request, env, url);
  }

  if (NOT_FOUND_ROUTE.test(url.pathname)) {
    return notFoundPage(request, env, url);
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response('Not found.', { status: 404 });
  }
  return env.ASSETS.fetch(request);
}
