import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { HomePage } from '../home/HomePage';
import '../home/home.css';
import { ShoppingListPage } from '../list/ShoppingListPage';
import { PantryPage } from '../pantry/PantryPage';
import { PlanRoute } from '../plan/PlanRoute';
import { AccountPage } from '../more/AccountPage';
import { AppTour } from '../more/AppTour';
import { HelpAboutPage } from '../more/HelpAboutPage';
import { HouseholdPage } from '../more/HouseholdPage';
import { MorePage } from '../more/MorePage';
import { StoresPage } from '../more/StoresPage';
import { ProductCatalogPage } from '../products/ProductCatalogPage';
import { useConfirm } from './DialogProvider';
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
  const { session, logout } = useAuth();
  const confirm = useConfirm();
  const { requestNavigation } = useDirtyState();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [tourOpen, setTourOpen] = useState(false);

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
        : location.pathname.startsWith('/app/more')
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

  const startTour = () => setTourOpen(true);

  const moreContent = location.pathname === '/app/more/products'
    ? <ProductCatalogPage />
    : location.pathname === '/app/more/help'
      ? <HelpAboutPage onStartTour={startTour} />
      : location.pathname === '/app/more/account'
        ? <AccountPage />
        : location.pathname === '/app/more/household'
          ? <HouseholdPage />
          : location.pathname === '/app/more/stores'
            ? <StoresPage />
            : <MorePage onStartTour={startTour} />;

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
          <button type="button" className="shell-button shell-button-secondary shell-desktop-signout" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="shell-content">
        {currentTab === 'list'
          ? <ShoppingListPage />
          : currentTab === 'inventory'
            ? <PantryPage />
            : currentTab === 'meal-plan'
              ? <PlanRoute />
              : currentTab === 'more'
                ? moreContent
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

      {tourOpen && <AppTour onClose={() => setTourOpen(false)} />}
    </div>
  );
}
