import { lazy, Suspense, useEffect } from 'react';

import { generateNoteId, isNoteId, notePath } from '../shared/ids';
import { Landing } from './landing/Landing';
import { loadNotePage } from './loadNote';
import { matchRoute, redirect, usePathname } from './router';

// The editor, Lexical and Yjs load only on a note page, so the landing page stays light.
const NotePage = lazy(loadNotePage);

export function App() {
  const route = matchRoute(usePathname());
  const invalid = route.name === 'missing' || (route.name === 'note' && !isNoteId(route.id));

  useEffect(() => {
    // Unknown paths and malformed note links go home (the Worker already
    // answers 400 for a malformed /n/ link loaded directly).
    if (invalid) {
      redirect('/');
    }
  }, [invalid]);

  useEffect(() => {
    // `/new` (and `/new?example`) start a fresh shared note for now.
    if (route.name === 'new') {
      redirect(notePath(generateNoteId()));
    }
  }, [route.name]);

  if (route.name === 'new') {
    return null;
  }
  if (route.name === 'note' && !invalid) {
    return (
      <Suspense fallback={null}>
        <NotePage key={route.id} id={route.id} />
      </Suspense>
    );
  }
  return <Landing />;
}
