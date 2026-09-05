import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import { changePassword, deleteAccount, updateProfile } from './settingsApi';
import './more.css';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AccountPage() {
  const navigate = useNavigate();
  const { session, isOwner, reload } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const user = session?.user;
  const offline = Boolean(session?.offlineSession);

  const [name, setName] = useState(user?.name ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? user?.name?.split(/\s+/)[0] ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [barcodePreference, setBarcodePreference] = useState<'inherit' | 'true' | 'false'>(() => {
    const value = user?.preferences?.barcodeAutoAccept;
    return value === null || value === undefined ? 'inherit' : String(value) as 'true' | 'false';
  });
  const [barcodeSaving, setBarcodeSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (offline || profileSaving) return;
    setProfileSaving(true);
    try {
      await updateProfile({ name: name.trim(), displayName: displayName.trim(), email: email.trim() });
      await reload();
      showToast('Profile updated', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to update profile'), { tone: 'error' });
    } finally {
      setProfileSaving(false);
    }
  };

  const saveBarcodePreference = async (value: 'inherit' | 'true' | 'false') => {
    if (offline || barcodeSaving) return;
    const previous = barcodePreference;
    setBarcodePreference(value);
    setBarcodeSaving(true);
    try {
      await updateProfile({ barcodeAutoAccept: value === 'inherit' ? null : value === 'true' });
      await reload();
      showToast('Barcode preference saved', { tone: 'success' });
    } catch (error) {
      setBarcodePreference(previous);
      showToast(errorMessage(error, 'Failed to save preference'), { tone: 'error' });
    } finally {
      setBarcodeSaving(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (offline || passwordSaving) return;
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', { tone: 'error' });
      return;
    }
    setPasswordSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('Password changed', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to change password'), { tone: 'error' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDeleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (offline || deleting || isOwner || !deleteAcknowledged || !deletePassword) return;
    const approved = await confirm({
      title: 'Delete your account permanently?',
      message: 'Your sign-in and personal account data will be removed. Shared household records stay with the household. This cannot be undone.',
      confirmLabel: 'Delete my account',
      cancelLabel: 'Keep account',
      danger: true
    });
    if (!approved) return;

    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      localStorage.removeItem('provista_auth');
      window.location.assign('/');
    } catch (error) {
      showToast(errorMessage(error, 'Failed to delete account'), { tone: 'error' });
      setDeleting(false);
    }
  };

  return (
    <section className="more-page" aria-labelledby="account-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}>
          <span aria-hidden="true">←</span> More
        </button>
        <p className="more-eyebrow">Personal settings</p>
        <h1 id="account-title">My Account</h1>
        <p>Manage your profile and sign-in preferences without leaving Provista.</p>
      </header>

      {offline && <div className="more-status-card" role="status">Reconnect to change account settings.</div>}

      <div className="more-settings-stack">
        <form className="more-settings-card" onSubmit={saveProfile}>
          <div>
            <h2>Profile</h2>
            <p>Your preferred name is what your household sees in shared planning screens.</p>
          </div>
          <label className="more-field">
            <span>Full name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required disabled={offline || profileSaving} />
          </label>
          <label className="more-field">
            <span>Preferred name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} disabled={offline || profileSaving} />
          </label>
          <label className="more-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={offline || profileSaving} />
          </label>
          <button type="submit" className="shell-button shell-button-primary" disabled={offline || profileSaving}>
            {profileSaving ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        {session?.features.barcodeScanning && (
          <section className="more-settings-card" aria-labelledby="account-barcode-title">
            <div>
              <h2 id="account-barcode-title">Barcode scanning</h2>
              <p>Override the household match-confirmation preference for your scans only.</p>
            </div>
            <label className="more-field">
              <span>Barcode matches</span>
              <select
                value={barcodePreference}
                disabled={offline || barcodeSaving}
                onChange={(event) => void saveBarcodePreference(event.target.value as 'inherit' | 'true' | 'false')}
              >
                <option value="inherit">Use household setting</option>
                <option value="true">Always auto-accept</option>
                <option value="false">Always confirm</option>
              </select>
            </label>
          </section>
        )}

        <form className="more-settings-card" onSubmit={savePassword}>
          <div>
            <h2>Change password</h2>
            <p>Use at least eight characters for the new password.</p>
          </div>
          <label className="more-field">
            <span>Current password</span>
            <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required disabled={offline || passwordSaving} />
          </label>
          <label className="more-field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required disabled={offline || passwordSaving} />
          </label>
          <label className="more-field">
            <span>Confirm new password</span>
            <input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={offline || passwordSaving} />
          </label>
          <button type="submit" className="shell-button shell-button-primary" disabled={offline || passwordSaving}>
            {passwordSaving ? 'Changing…' : 'Change password'}
          </button>
        </form>

        <form className="more-settings-card more-danger-zone" onSubmit={handleDeleteAccount}>
          <div>
            <h2>Delete account</h2>
            {isOwner
              ? <p>You are the household owner. Delete the household or transfer ownership before deleting your account.</p>
              : <p>This permanently removes your sign-in and personal account data. Shared household records remain.</p>}
          </div>
          {!isOwner && (
            <>
              <label className="more-field">
                <span>Password</span>
                <input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required disabled={offline || deleting} />
              </label>
              <label className="more-check-row">
                <input type="checkbox" checked={deleteAcknowledged} onChange={(event) => setDeleteAcknowledged(event.target.checked)} disabled={offline || deleting} />
                <span>I understand this cannot be undone.</span>
              </label>
              <button type="submit" className="shell-button shell-button-danger" disabled={offline || deleting || !deleteAcknowledged || !deletePassword}>
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
