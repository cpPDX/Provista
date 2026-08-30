import { useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from './DialogProvider';
import { useDirtyState } from './DirtyStateProvider';
import { useToast } from './ToastProvider';

const navItems = [
  { label: 'Home', tab: 'home', icon: '⌂' },
  { label: 'Plan', tab: 'meal-plan', icon: '◷' },
  { label: 'List', tab: 'list', icon: '✓' },
  { label: 'Pantry', tab: 'inventory', icon: '▦' },
  { label: 'More', tab: 'more', icon: '☰' }
] as const;

export function AppShell() {
  const { session, logout } = useAuth();
  const confirm = useConfirm();
  const { requestNavigation } = useDirtyState();
  const { showToast } = useToast();

  useEffect(() => {
    if (!session?.offlineSession) return;
    showToast('Using your cached Provista session. Reconnect to refresh household data.', {
      tone: 'info',
      durationMs: 5000
    });
  }, [session?.offlineSession, showToast]);

  if (!session) return null;

  const displayName = session.user.displayName || session.user.name;
  const householdName = session.household?.name || 'Your household';

  const openLegacyTab = (tab: string) => {
    void requestNavigation(() => {
      window.location.assign(`/app?tab=${encodeURIComponent(tab)}`);
    });
  };

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: 'Sign out?',
      message: 'You’ll return to the Provista welcome page. Your household data stays saved.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in'
    });
    if (confirmed) await logout();
  };

  return (
    <div className="shell-app">
      {session.offlineSession && (
        <div className="shell-offline-banner" role="status">
          Offline session - reconnect to refresh data
        </div>
      )}

      <header className="shell-header">
        <div className="shell-brand">
          <img src="/brand/provista-mark.svg" width="34" height="34" alt="" />
          <div>
            <strong>Provista</strong>
            <span>React shell migration</span>
          </div>
        </div>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </header>

      <main className="shell-content">
        <section className="shell-welcome" aria-labelledby="shell-heading">
          <p className="shell-eyebrow">PRO-51 · authenticated application shell</p>
          <h1 id="shell-heading">Welcome, {displayName}</h1>
          <p><strong>{householdName}</strong> is loaded through the new React session context.</p>
        </section>

        <section className="shell-card" aria-labelledby="shell-status-heading">
          <h2 id="shell-status-heading">Migration boundary</h2>
          <p>
            React now owns this shell’s authenticated session, navigation contract, confirmation dialogs,
            toast feedback, dirty-state guard, and error/loading states. Feature screens still open in the
            existing application until each one is migrated and covered by regression tests.
          </p>
          <dl className="shell-session-grid">
            <div>
              <dt>Role</dt>
              <dd>{session.user.role}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{session.offlineSession ? 'Cached / offline' : 'Online'}</dd>
            </div>
            <div>
              <dt>Offline access</dt>
              <dd>{session.features.offlineAccess ? 'Enabled' : 'Unavailable'}</dd>
            </div>
          </dl>
        </section>
      </main>

      <nav className="shell-bottom-nav" aria-label="Provista sections">
        {navItems.map((item) => (
          <button key={item.tab} type="button" onClick={() => openLegacyTab(item.tab)} aria-label={item.label}>
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
