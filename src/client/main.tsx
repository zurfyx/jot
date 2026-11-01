import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
// The cascade layers, in order, before any stylesheet uses one (D28).
import 'virtual:stylex-order.css';
import './globals.css';

import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { App } from './App';

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
// The landing page, the docs and the 404 page arrive prerendered (D31): React
// takes over their HTML. A note's page starts from the empty shell.
if (root.hasChildNodes()) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
