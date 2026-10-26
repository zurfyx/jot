import { isNoteId } from '../shared/ids';

import { NOTE_ID_HEADER } from './room';

export { NoteRoom } from './room';

const SOCKET_ROUTE = /^\/api\/n\/([^/]+)\/ws$/;
const NOTE_ROUTE = /^\/n\/([^/]+)\/?$/;

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

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
  },
} satisfies ExportedHandler<Env>;
