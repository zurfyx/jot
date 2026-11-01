import { StrictMode } from 'react';
import { prerender } from 'react-dom/static';

import { App } from './App';
import { setPrerenderPath } from './router';

export { PAGE_HEADS } from './heads';
export { LANDING_HEAD, NOT_FOUND_TITLE, SITE_NAME, siteUrl } from './site';

/**
 * The prerender's entry (scripts/prerender.ts, D31): the app rendered at
 * `path` to HTML, as the browser's first render will see it, lazy pages
 * included. Nothing here runs in the browser.
 */
export async function renderPage(path: string): Promise<string> {
  setPrerenderPath(path);
  const { prelude } = await prerender(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return new Response(prelude).text();
}
