import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { queryClient } from './app/queryClient';
import { AuthProvider } from './auth/AuthProvider';
import { DialogProvider } from './shell/DialogProvider';
import { DirtyStateProvider } from './shell/DirtyStateProvider';
import { ToastProvider } from './shell/ToastProvider';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Provista React root element was not found');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <DialogProvider>
            <DirtyStateProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </DirtyStateProvider>
          </DialogProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
