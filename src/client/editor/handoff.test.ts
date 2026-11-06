import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeUpload, sha256Hex, UNKNOWN_GENERATION } from '../../shared/fence';
import { handOff, uploadMaterial } from './handoff';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The server's acknowledgement of `body`, uploaded by a tab to note `room`. */
async function ack(body: Uint8Array, overrides: Record<string, unknown> = {}) {
  const upload = decodeUpload(body);
  return Response.json({
    v: 1,
    room: 'n',
    replica: upload.replica,
    sourceGeneration: upload.source.generation ?? UNKNOWN_GENERATION,
    record: 'yr1-sha256:r',
    hash: 'yr1-sha256:r',
    upload: await sha256Hex(body),
    seq: 1,
    actionable: true,
    ...overrides,
  });
}

function binding(state = new Uint8Array([0, 0]), differs = false) {
  const calls: string[] = [];
  return {
    calls,
    binding: {
      quiesce: () => {
        calls.push('quiesce');
        return { state, draft: { json: { root: {} }, differs } };
      },
    } as unknown as Parameters<typeof handOff>[0]['binding'],
  };
}

describe('the handoff', () => {
  it('quiesces, uploads the whole document and resolves only on an acknowledgement of exactly it', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const { binding: b, calls } = binding(new Uint8Array([0, 0]), true);
    const bodies: Uint8Array[] = [];
    const responses = [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response('busy', { status: 503 })),
      // A bare hash acknowledges nothing, nor one scoped to another note,
      // replica or generation, or of another version.
      async () => Response.json({ upload: await sha256Hex(bodies[0]!) }),
      async () => ack(bodies[0]!, { upload: 'not the hash' }),
      async () => ack(bodies[0]!, { room: 'other' }),
      async () => ack(bodies[0]!, { replica: 'copy' }),
      async () => ack(bodies[0]!, { sourceGeneration: 'g1:["other",[]]' }),
      async () => ack(bodies[0]!, { v: 2 }),
      async () => ack(bodies[0]!),
    ];
    const sleeps: number[] = [];
    const result = await handOff(
      { noteId: 'n', binding: b, generation: null, clients: [5] },
      {
        fetch: (async (_url: string, init: RequestInit) => {
          bodies.push(init.body as Uint8Array);
          calls.push('post');
          return responses.shift()!();
        }) as typeof fetch,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result).toBe('saved');
    expect(calls).toEqual(['quiesce', ...Array<string>(9).fill('post')]);
    // The same bytes every time: nothing can grow once every writer stopped.
    expect(new Set(bodies.map((b) => b.join(','))).size).toBe(1);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    const upload = decodeUpload(bodies[0]!);
    expect(upload.source.generation).toBe(UNKNOWN_GENERATION);
    expect(upload.clients).toEqual([5]);
    expect(upload.peers).toBe(false);
    expect(upload.draft?.differs).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('jot:uploaded:n')!)).toEqual([
      await sha256Hex(bodies[0]!),
    ]);
  });

  it('keeps no draft when the editor committed everything', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const { binding: b } = binding();
    let body: Uint8Array | null = null;
    await handOff(
      { noteId: 'n', binding: b, generation: 'g/-', clients: [] },
      {
        fetch: (async (_url: string, init: RequestInit) => {
          body = init.body as Uint8Array;
          return ack(body);
        }) as typeof fetch,
        sleep: async () => {},
      },
    );
    const upload = decodeUpload(body!);
    expect(upload.draft).toBeNull();
    expect(upload.source.generation).toBe('g/-');
  });

  it('is refused, uploading nothing, when quiesce() refuses the editor state', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = {
      quiesce: () => {
        throw new TypeError('the editor state does not serialize as JSON');
      },
    } as unknown as Parameters<typeof handOff>[0]['binding'];
    let posts = 0;
    const result = await handOff(
      { noteId: 'n', binding: b, generation: null, clients: [] },
      {
        fetch: (async () => {
          posts++;
          return new Response('ok');
        }) as typeof fetch,
        sleep: async () => {},
      },
    );
    expect(result).toBe('refused');
    expect(posts).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('stops at a refusal, and gives up after the attempts a copy gets', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const { binding: b } = binding();
    const refused = await handOff(
      { noteId: 'n', binding: b, generation: null, clients: [] },
      {
        fetch: (async () => new Response('full', { status: 507 })) as typeof fetch,
        sleep: async () => {},
      },
    );
    expect(refused).toBe('refused');
    let posts = 0;
    const later = await uploadMaterial(
      'n',
      decodeUpload(
        (await (async () => {
          let captured: Uint8Array | null = null;
          await handOff(
            { noteId: 'n', binding: b, generation: null, clients: [] },
            {
              fetch: (async (_u: string, init: RequestInit) => {
                captured = init.body as Uint8Array;
                return new Response('full', { status: 507 });
              }) as typeof fetch,
              sleep: async () => {},
            },
          );
          return captured!;
        })()) as Uint8Array,
      ),
      {
        fetch: (async () => {
          posts++;
          throw new Error('offline');
        }) as typeof fetch,
        sleep: async () => {},
      },
      3,
    );
    expect(later.result).toBe('later');
    expect(posts).toBe(3);
  });
});
