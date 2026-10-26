import { isNoteId } from '../shared/ids';

import { NOTE_ID_HEADER } from './room';

export { NoteRoom } from './room';

const SOCKET_ROUTE = /^\/api\/n\/([^/]+)\/ws$/;
const NOTE_ROUTE = /^\/n\/([^/]+)\/?$/;

/**
 * Notes and the API stay out of search engines; the landing page does not (D17). A Preview
 * (D10) is out of them entirely: `previews.vars` in wrangler.jsonc sets JOT_ENV.
 */
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
    const noIndex = env.JOT_ENV === 'preview' || isPrivatePath(url.pathname);
    return noIndex ? withNoIndex(response) : response;
  },
} satisfies ExportedHandler<Env>;

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

  const note = NOTE_ROUTE.exec(url.pathname);
  if (note !== null) {
    if (!isNoteId(note[1] ?? '')) {
      return badRequest('Not a note link.');
    }
    // The SPA: the client router renders the note.
    return env.ASSETS.fetch(new Request(new URL('/', url), request));
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response('Not found.', { status: 404 });
  }
  return env.ASSETS.fetch(request);
}
