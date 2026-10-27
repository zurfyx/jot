import { Theme } from '@astryxdesign/core/theme';
import { lazy, type ReactNode, Suspense, useEffect } from 'react';

import { isNoteId } from '../shared/ids';
import { useExampleId } from './examples';
import { Landing } from './landing/Landing';
import { loadNotePage } from './loadNote';
import { newNotePath } from './notes';
import { matchRoute, redirect, useLocationPath } from './router';
import { useThemeName } from './theme';
import { jotTheme } from './theme/jot';

// The editor, Lexical and Yjs load only on a note page, so the landing page stays light.
const NotePage = lazy(loadNotePage);
// The docs are their own chunk too; their live inspector loads Lexical only on its page.
const DocsPage = lazy(() => import('./docs/DocsPage'));

/** A `/new` redirect is being resolved (it waits for a legacy draft's lock). */
let redirecting = false;

/**
 * Astryx's theme provider around every page (D28). It mirrors jot's light or
 * dark choice: `mode` follows the theme jot keeps on <html>.
 */
function AstryxTheme({ children }: { children: ReactNode }) {
  return (
    <Theme theme={jotTheme} mode={useThemeName()}>
      {children}
    </Theme>
  );
}

export function App() {
  return (
    <AstryxTheme>
      <Page />
    </AstryxTheme>
  );
}

function Page() {
  const route = matchRoute(useLocationPath());
  const exampleId = useExampleId();
  const invalid = route.name === 'missing' || (route.name === 'note' && !isNoteId(route.id));

  useEffect(() => {
    // Unknown paths and malformed note links go home (the Worker already
    // answers 400 for a malformed /n/ link loaded directly).
    if (invalid) {
      redirect('/');
    }
  }, [invalid]);

  useEffect(() => {
    // `/new` (old links, a modified click on a start link) opens a fresh
    // shared note (D23). Checked against the address itself, before and
    // after picking the note, so Strict Mode's second run doesn't start a
    // second note.
    const onNew = () => matchRoute(window.location.pathname).name === 'new';
    if (route.name === 'new' && onNew() && !redirecting) {
      redirecting = true;
      void newNotePath().then((path) => {
        redirecting = false;
        if (onNew()) {
          redirect(path);
        }
      });
    }
  }, [route.name]);

  if (route.name === 'new') {
    return null;
  }
  // The example is a shared note from the start (D20). Its page keeps the
  // same key, so the same editor, when it moves to /n/<id>.
  if (route.name === 'example' && exampleId !== null) {
    return (
      <Suspense fallback={null}>
        <NotePage key={exampleId} id={exampleId} />
      </Suspense>
    );
  }
  if (route.name === 'note' && !invalid) {
    return (
      <Suspense fallback={null}>
        <NotePage key={route.id} id={route.id} />
      </Suspense>
    );
  }
  if (route.name === 'docs') {
    return (
      <Suspense fallback={null}>
        <DocsPage slug={route.slug} />
      </Suspense>
    );
  }
  return <Landing />;
}
