import { lazy, Suspense, useEffect } from 'react';

import { isNoteId } from '../shared/ids';
import { useDraftPage } from './drafts';
import { useExampleId } from './examples';
import { Landing } from './landing/Landing';
import { loadNotePage } from './loadNote';
import { matchRoute, redirect, useLocationPath } from './router';

// The editor, Lexical and Yjs load only on a note page, so the landing page stays light.
const NotePage = lazy(loadNotePage);

export function App() {
  const route = matchRoute(useLocationPath());
  const draft = useDraftPage();
  const exampleId = useExampleId();
  const invalid = route.name === 'missing' || (route.name === 'note' && !isNoteId(route.id));

  useEffect(() => {
    // Unknown paths and malformed note links go home (the Worker already
    // answers 400 for a malformed /n/ link loaded directly).
    if (invalid) {
      redirect('/');
    }
  }, [invalid]);

  // A draft keeps its editor when Share moves it to /n/<id> (D18).
  if (route.name === 'new' || (route.name === 'note' && route.id === draft.sharedAs)) {
    return (
      <Suspense fallback={null}>
        <NotePage key={draft.key} id={null} />
      </Suspense>
    );
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
  return <Landing />;
}
