import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { HomePage } from '../home/HomePage';
import '../home/home.css';
import { ShoppingListPage } from '../list/ShoppingListPage';
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
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session?.offlineSession) return;
    showToast('Using your cached Provista session. Reconnect to refresh household data.', {
      tone: 'info',
      durationMs: 5000
    });
  }, [session?.offlineSession, showToast]);

  if (!session) return null;

  const householdName = session.household?.name || 'Your household';
  const currentTab = location.pathname === '/app/list' ? 'list' : 'home';

  const openTab = (tab: string) => {
    if (tab === 'home' || tab === 'list') {
      const destination = tab === 'home' ? '/app' : '/app/list';
      if (location.pathname === destination) return;
      void requestNavigation(() => navigate(destination));
      return;
    }
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
            <span>{householdName}</span>
          </div>
        </div>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => void handleLogout()}>
          Sign out
        </button>
      </header>

      <main className="shell-content">
        {currentTab === 'list' ? <ShoppingListPage /> : <HomePage />}
      </main>

      <nav className="shell-bottom-nav" aria-label="Provista sections">
        {navItems.map((item) => (
          <button
            key={item.tab}
            type="button"
            onClick={() => openTab(item.tab)}
            aria-label={item.label}
            aria-current={item.tab === currentTab ? 'page' : undefined}
            className={item.tab === currentTab ? 'active' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
