import { Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AppShell } from '../shell/AppShell';
import { ShellErrorBoundary } from '../shell/ShellErrorBoundary';

function AuthenticatedShell() {
  const { status, error, reload } = useAuth();

  if (status === 'loading' || status === 'redirecting') {
    return (
      <main className="shell-state" aria-busy="true">
        <section className="shell-state-card">
          <div className="shell-spinner" aria-hidden="true" />
          <h1>Loading Provista</h1>
          <p>Checking your household session…</p>
        </section>
      </main>
    );
  }

  if (status === 'unavailable') {
    return (
      <main className="shell-state">
        <section className="shell-state-card">
          <h1>Provista is unavailable</h1>
          <p>{error ?? 'Your household session could not be loaded.'}</p>
          <div className="shell-state-actions">
            <button type="button" className="shell-button shell-button-primary" onClick={() => void reload()}>
              Try again
            </button>
            <a className="shell-button shell-button-secondary shell-link-button" href="/app">Open current app</a>
          </div>
        </section>
      </main>
    );
  }

  return <AppShell />;
}

export function App() {
  return (
    <ShellErrorBoundary>
      <Routes>
        <Route path="*" element={<AuthenticatedShell />} />
      </Routes>
    </ShellErrorBoundary>
  );
}
