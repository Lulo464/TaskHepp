import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles/nocturne.css';
import './styles/app.css';
import './i18n';
import { App } from './App';
import { StoreProvider } from './lib/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
