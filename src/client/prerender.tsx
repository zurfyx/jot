import { type ReactNode, StrictMode } from 'react';
import { prerender } from 'react-dom/static';

import { App } from './App';
import { NoScriptNotice } from './NotFound';
import { setPrerenderPath } from './router';

export { headTags, LANDING_HEAD } from './head';
export { PAGE_HEADS } from './heads';
export { DOCS_GROUPS, DOCS_PAGES, docsPath } from './docs/pages';
export { NOT_FOUND_TITLE, SITE_NAME, siteUrl } from './site';

/**
 * The prerender's entry (scripts/prerender.ts, D31). Nothing here runs in the
 * browser.
 */

/**
 * `element` rendered to HTML, lazy parts included. React keeps rendering past
 * an error inside a Suspense boundary and leaves that boundary for the
 * browser to render (an empty fallback in the HTML), so every error it
 * reports fails the render instead.
 */
export async function renderToHtml(element: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  const { prelude } = await prerender(element, {
    onError(error) {
      errors.push(error);
    },
  });
  const html = await new Response(prelude).text();
  if (errors.length > 0) {
    const messages = errors.map((error) =>
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    throw new Error(`the render reported ${errors.length} error(s):\n${messages.join('\n')}`);
  }
  return html;
}

/** The app at `path`, as the browser's first render will see it. */
export function renderPage(path: string): Promise<string> {
  setPrerenderPath(path);
  return renderToHtml(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/** What a note's shell shows when scripts are off: notes need JavaScript. */
export function renderNoScriptNotice(): Promise<string> {
  return renderToHtml(<NoScriptNotice />);
}
