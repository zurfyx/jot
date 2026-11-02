import { LANDING_DESCRIPTION, LANDING_TITLE, NOT_FOUND_TITLE, SITE_URL } from './site';

/**
 * Keeps the head right for the landing page, the 404 page and a note (D31),
 * without putting `head.ts` in the entry chunk. A note's head and the 404
 * page's need no data: this file drops a public page's tags itself. The
 * landing page's are built by `head.ts`, which loads only when they are not
 * already in place (the app moved here from another page without a reload).
 */
export type HeadFor = 'landing' | 'not-found' | 'note';

/** The tags a page's head carries for search engines and link previews, besides its title. */
export const MANAGED =
  'link[rel=canonical],meta[property^="og:"],meta[name^="twitter:"],meta[name=robots],script[type="application/ld+json"]';

let turn = 0;

/**
 * Claims the head for the page now showing. A head still loading for an
 * earlier page is dropped when it arrives: the page has moved on.
 */
export function claimHead(): number {
  turn += 1;
  return turn;
}

/** Sets the title and description, and removes every managed tag. */
export function resetHead(title: string, description: string): void {
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document.head.querySelectorAll(MANAGED).forEach((element) => element.remove());
}

export function syncHead(page: HeadFor): void {
  const mine = claimHead();
  if (page === 'note') {
    // A note's own title comes from its page (NotePage), once it has one.
    resetHead(document.title, LANDING_DESCRIPTION);
    return;
  }
  if (page === 'not-found') {
    resetHead(NOT_FOUND_TITLE, LANDING_DESCRIPTION);
    document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="noindex">');
    return;
  }
  // The landing page: its title at once, its other tags from head.ts unless
  // they are already there.
  document.title = LANDING_TITLE;
  const canonical = document.querySelector('link[rel=canonical]')?.getAttribute('href');
  if (canonical === `${SITE_URL}/` && document.querySelector('meta[name=robots]') === null) {
    return;
  }
  import('./head').then(
    ({ applyHead, LANDING_HEAD }) => {
      if (mine === turn) {
        applyHead(LANDING_HEAD);
      }
    },
    () => {
      // Offline, or a deploy replaced the file: the title is right, and the
      // next page the app moves to tries again.
    },
  );
}
