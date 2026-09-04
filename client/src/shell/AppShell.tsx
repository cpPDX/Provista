import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { HomePage } from '../home/HomePage';
import '../home/home.css';
import { ShoppingListPage } from '../list/ShoppingListPage';
import { PantryPage } from '../pantry/PantryPage';
import { PlanPage } from '../plan/PlanPage';
import { MorePage } from '../more/MorePage';
import { useDirtyState } from './DirtyStateProvider';
import { NavIcon } from './NavIcon';
import { ThemeToggle } from './ThemeToggle';
import { useToast } from './ToastProvider';

const navItems = [
  { label: 'Home', tab: 'home', icon: 'home' },
  { label: 'Plan', tab: 'meal-plan', icon: 'plan' },
  { label: 'List', tab: 'list', icon: 'list' },
  { label: 'Pantry', tab: 'inventory', icon: 'pantry' },
  { label: 'More', tab: 'more', icon: 'more' }
] as const;

export function AppShell() {
  const { session } = useAuth();
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
  const currentTab = location.pathname === '/app/list'
    ? 'list'
    : location.pathname === '/app/pantry'
      ? 'inventory'
      : location.pathname === '/app/plan'
        ? 'meal-plan'
        : location.pathname === '/app/more'
          ? 'more'
          : 'home';

  const openTab = (tab: string) => {
    const reactDestinations: Record<string, string> = {
      home: '/app',
      'meal-plan': '/app/plan',
      list: '/app/list',
      inventory: '/app/pantry',
      more: '/app/more'
    };
    const destination = reactDestinations[tab];
    if (destination) {
      if (location.pathname === destination) return;
      void requestNavigation(() => navigate(destination));
      return;
    }
    void requestNavigation(() => {
      window.location.assign(`/app?tab=${encodeURIComponent(tab)}`);
    });
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
        <div className="shell-header-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="shell-content">
        {currentTab === 'list'
          ? <ShoppingListPage />
          : currentTab === 'inventory'
            ? <PantryPage />
            : currentTab === 'meal-plan'
              ? <PlanPage />
              : currentTab === 'more'
                ? <MorePage />
              : <HomePage />}
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
            <span className="shell-nav-icon" aria-hidden="true"><NavIcon name={item.icon} /></span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
