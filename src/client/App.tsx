import { lazy, Suspense, useEffect } from 'react';

import { isNoteId } from '../shared/ids';
import { useExampleId } from './examples';
import { syncHead } from './syncHead';
import { useHydratedMark } from './hydrated';
import { Landing } from './landing/Landing';
import { loadNotePage } from './loadNote';
import { newNotePath } from './notes';
import NotFound from './NotFound';
import { matchRoute, redirect, useLocationPath } from './router';

// The editor, Lexical and Yjs load only on a note page, so the landing page stays light.
const NotePage = lazy(loadNotePage);
// The docs are their own chunk too; their live inspector loads Lexical only on its page.
const DocsPage = lazy(() => import('./docs/DocsPage'));

/** A `/new` redirect is being resolved (it waits for a legacy draft's lock). */
let redirecting = false;

export function App() {
  const route = matchRoute(useLocationPath());
  const exampleId = useExampleId();
  const invalid = route.name === 'note' && !isNoteId(route.id);

  // A note's page is live once App has rendered (it is never prerendered). The
  // prerendered pages, the landing page, the docs and the 404 page, mark
  // themselves once their own boundary has hydrated (D31).
  useHydratedMark(route.name === 'note' || route.name === 'new' || route.name === 'example');

  useEffect(() => {
    // A note's head has none of a public page's tags (D31); its page sets the title.
    if (route.name === 'note' || route.name === 'new' || route.name === 'example') {
      syncHead('note');
    }
  }, [route.name]);

  useEffect(() => {
    // Malformed note links go home (the Worker already answers 400 for a
    // malformed /n/ link loaded directly).
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
  if (route.name === 'missing') {
    // 404.html, the Worker's answer to any path no page matches (D31). A docs
    // page that doesn't exist shows it too, from inside the docs' Suspense
    // boundary, so the 404 page has the same boundary to hydrate either way.
    return (
      <Suspense fallback={null}>
        <NotFound />
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
