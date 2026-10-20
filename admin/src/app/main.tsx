import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import '../styles/nocturne.css';
import '../styles/app.css';
import './pwa.css';
import '../i18n';
import { ApiProvider } from '../lib/api';
import { PwaApp } from './PwaApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider>
      <PwaApp />
    </ApiProvider>
  </StrictMode>,
);

// Offline start and "add to home screen". Not in dev, where it would cache Vite's modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
