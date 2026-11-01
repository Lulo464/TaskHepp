import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles/fonts';
import './styles/nocturne.css';
import './styles/app.css';
import './i18n';
import { App } from './App';
import { ApiProvider } from './lib/api';
import { MonitorDisplay } from './MonitorDisplay';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/monitor' ? <MonitorDisplay /> : (
      <ApiProvider>
        <App />
      </ApiProvider>
    )}
  </StrictMode>,
);
