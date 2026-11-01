import { siteUrl } from './site';

/**
 * Keeps the head right for the landing page, the 404 page and a note (D31),
 * without putting `head.ts` in the entry chunk: a page loaded directly already
 * has its head (prerendered, or the shell's), so `head.ts` loads only when the
 * app has moved here from another page without a reload.
 */
export type HeadFor = 'landing' | 'not-found' | 'note';

/** Whether the head is already the one `page` needs. */
function inPlace(page: HeadFor): boolean {
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  const noindex = document.querySelector('meta[name="robots"]') !== null;
  if (page === 'landing') {
    return canonical === siteUrl('/') && !noindex;
  }
  return canonical === null && noindex === (page === 'not-found');
}

export function syncHead(page: HeadFor): void {
  if (inPlace(page)) {
    return;
  }
  void import('./head').then(({ applyHead }) => applyHead(page));
}
