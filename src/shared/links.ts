import { isNoteId } from './ids';

/** Hosts whose `/n/<id>` links are jot links. */
export const JOT_HOSTS = ['jot.rovira.sh', 'localhost', '127.0.0.1'];

/**
 * The note id in what someone pasted: a full jot link, a link without the
 * scheme, or just the code. Returns null for anything else.
 *
 * `currentHost` (the page's own host) is also accepted, so links from a
 * local or preview deployment open there.
 */
export function parseNoteInput(input: string, currentHost?: string): string | null {
  const value = input.trim();
  if (value === '') {
    return null;
  }
  if (isNoteId(value)) {
    return value;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  const hosts = currentHost ? [...JOT_HOSTS, currentHost] : JOT_HOSTS;
  if (!hosts.includes(url.hostname) && !hosts.includes(url.host)) {
    return null;
  }
  const match = /^\/n\/([^/]+)\/?$/.exec(url.pathname);
  if (match === null) {
    return null;
  }
  const id = match[1] ?? '';
  return isNoteId(id) ? id : null;
}
