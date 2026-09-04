import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import './more.css';

type MoreIconName = 'insights' | 'account' | 'household' | 'products' | 'stores' | 'import' | 'about' | 'tour' | 'signout';

interface MoreDestination {
  id: string;
  label: string;
  detail: string;
  icon: MoreIconName;
  section?: string;
  action?: string;
  adminOnly?: boolean;
}

const destinations: MoreDestination[] = [
  { id: 'insights', label: 'Insights', detail: 'Price history and household spending', icon: 'insights', section: 'insights' },
  { id: 'account', label: 'My Account', detail: 'Profile, password, and personal preferences', icon: 'account', section: 'account' },
  { id: 'household', label: 'Household', detail: 'People, roles, invitations, and defaults', icon: 'household', section: 'household' },
  { id: 'products', label: 'Manage products', detail: 'Household grocery catalog and product details', icon: 'products', section: 'items', adminOnly: true },
  { id: 'stores', label: 'Stores', detail: 'Shopping locations and store sections', icon: 'stores', section: 'stores', adminOnly: true },
  { id: 'import', label: 'Import prices', detail: 'Bring in household price history from CSV', icon: 'import', action: 'csv-import', adminOnly: true },
  { id: 'about', label: 'Help & About', detail: 'How Provista works and where to get started', icon: 'about', section: 'about' },
  { id: 'tour', label: 'App Tour', detail: 'Walk through the household grocery workflow', icon: 'tour', action: 'app-tour' }
];

function legacyHref(destination: MoreDestination) {
  const params = new URLSearchParams({ tab: 'more' });
  if (destination.section) params.set('section', destination.section);
  if (destination.action) params.set('action', destination.action);
  return `/app?${params.toString()}`;
}

function MoreIcon({ name }: { name: MoreIconName }) {
  if (name === 'insights') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  }
  if (name === 'account') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  }
  if (name === 'household') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M14 16a5 5 0 0 1 7.5 4" /></svg>;
  }
  if (name === 'products') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 12 9-9 9 9-9 9Z" /><circle cx="12" cy="9" r="1.5" /></svg>;
  }
  if (name === 'stores') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v11h16V10M3 10l2-7h14l2 7" /><path d="M8 21v-6h5v6M3 10c0 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0" /></svg>;
  }
  if (name === 'import') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>;
  }
  if (name === 'tour') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /><path d="m15 17 4 4" /></svg>;
  }
  if (name === 'signout') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
}

export function MorePage() {
  const { isAdmin, logout } = useAuth();
  const confirm = useConfirm();
  const visibleDestinations = destinations.filter(destination => !destination.adminOnly || isAdmin);

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
    <section className="more-page" aria-labelledby="more-title">
      <header className="more-heading">
        <p className="more-eyebrow">Household tools</p>
        <h1 id="more-title">More</h1>
        <p>Manage your household, review insights, and find the less-frequent tools that keep Provista useful.</p>
      </header>

      <div className="more-grid">
        {visibleDestinations.map(destination => (
          <a className="more-card" href={legacyHref(destination)} key={destination.id}>
            <span className="more-card-icon"><MoreIcon name={destination.icon} /></span>
            <span className="more-card-copy">
              <strong>{destination.label}</strong>
              <small>{destination.detail}</small>
            </span>
            <span className="more-card-arrow" aria-hidden="true">→</span>
          </a>
        ))}
        <button type="button" className="more-card more-card-button" onClick={() => void handleLogout()}>
          <span className="more-card-icon"><MoreIcon name="signout" /></span>
          <span className="more-card-copy">
            <strong>Sign out</strong>
            <small>End this session on this device</small>
          </span>
          <span className="more-card-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
