import { Suspense } from 'react';

import { renderPage as renderApp, renderToHtml } from '../../src/client/prerender';

export {
  headTags,
  LANDING_HEAD,
  NOT_FOUND_TITLE,
  PAGE_HEADS,
  renderNoScriptNotice,
} from '../../src/client/prerender';

/**
 * The app's prerender entry with one broken page, for scripts/prerender.test.ts:
 * `/docs/blame` throws inside a Suspense boundary (`JOT_BROKEN=throws`), or
 * renders without its content (`JOT_BROKEN=empty`).
 */

function Throws(): never {
  throw new Error('a page that throws while it renders');
}

export function renderPage(path: string): Promise<string> {
  if (path !== '/docs/blame') {
    return renderApp(path);
  }
  return renderToHtml(
    process.env.JOT_BROKEN === 'throws' ? (
      <Suspense fallback={null}>
        <Throws />
      </Suspense>
    ) : (
      <p>Nothing here.</p>
    ),
  );
}
