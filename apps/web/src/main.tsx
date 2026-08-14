import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { startThemeColorSync } from './lib/estate-theme.js';
import './styles.css';

// Browser chrome follows the active theme's ground (--et-bg). The stamp
// itself happened pre-paint in index.html; this only keeps the meta current.
startThemeColorSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
