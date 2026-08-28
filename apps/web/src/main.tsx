import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

async function bootstrap(): Promise<void> {
  const { hydrateLocalGameFromIndexedDb } = await import('./adapters/local-session/local-storage.js');
  await hydrateLocalGameFromIndexedDb();
  const { App } = await import('./app/App.js');
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () => {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {
        scope: import.meta.env.BASE_URL,
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}

void bootstrap();
