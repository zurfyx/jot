import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
// The cascade layers, in order, before any stylesheet uses one (D28).
import 'virtual:stylex-order.css';
import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
