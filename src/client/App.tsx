import { lazy, Suspense, useEffect } from 'react';

import { isNoteId } from '../shared/ids';
import { Landing } from './landing/Landing';
import { matchRoute, redirect, usePathname } from './router';

// The editor, Lexical and Yjs load only on a note page, so the landing page stays light.
const NotePage = lazy(() => import('./editor/NotePage'));

export function App() {
  const route = matchRoute(usePathname());
  const invalid = route.name === 'missing' || (route.name === 'note' && !isNoteId(route.id));

  useEffect(() => {
    if (route.name === 'landing') {
      document.title = 'jot · Write together, live';
    }
  }, [route.name]);

  useEffect(() => {
    // Unknown paths and malformed note links go home (the Worker already
    // answers 400 for a malformed /n/ link loaded directly).
    if (invalid) {
      redirect('/');
    }
  }, [invalid]);

  if (route.name === 'note' && !invalid) {
    return (
      <Suspense fallback={null}>
        <NotePage key={route.id} id={route.id} />
      </Suspense>
    );
  }
  return <Landing />;
}
