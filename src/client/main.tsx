import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyThemeClass } from './theme';

// The dark token set goes on <html> before anything renders.
applyThemeClass();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
