import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import {
  addHouseholdPerson,
  deleteHousehold,
  loadHousehold,
  loadInvite,
  loadStores,
  regenerateInvite,
  removeHouseholdPerson,
  removeMember,
  renameHousehold,
  updateHouseholdPerson,
  updateHouseholdSettings,
  updateMemberRole,
  type HouseholdMember,
  type HouseholdPayload,
  type HouseholdPerson,
  type HouseholdSettings,
  type InvitePayload,
  type StoreRecord
} from './settingsApi';
import './more.css';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function preferredName(member?: HouseholdMember | null) {
  const explicit = member?.displayName?.trim();
  if (explicit) return explicit;
  return member?.name?.trim().split(/\s+/)[0] || 'Person';
}

function roleLabel(role?: string) {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member';
}

interface RosterRow {
  key: string;
  person: HouseholdPerson | null;
  member: HouseholdMember | null;
  name: string;
}

export function HouseholdPage() {
  const navigate = useNavigate();
  const { session, isAdmin, isOwner, reload } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const offline = Boolean(session?.offlineSession);
  const currentUserId = session?.user._id ?? '';
  const [data, setData] = useState<HouseholdPayload | null>(null);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [householdName, setHouseholdName] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPersonName, setEditingPersonName] = useState('');
  const [rosterBusyId, setRosterBusyId] = useState<string | null>(null);
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteVersion, setInviteVersion] = useState(0);
  const [settings, setSettings] = useState<Required<Pick<HouseholdSettings, 'additionalStopSavingsThreshold' | 'priceFreshnessDays'>> & HouseholdSettings>({
    usualStoreId: null,
    additionalStopSavingsThreshold: 10,
    priceFreshnessDays: 30,
    strictPriceReview: false,
    barcodeAutoAccept: false
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [householdData, storeData] = await Promise.all([loadHousehold(), loadStores()]);
      setData(householdData);
      setStores(storeData);
      setHouseholdName(householdData.household.name);
      setSettings({
        usualStoreId: householdData.household.settings?.usualStoreId ?? null,
        additionalStopSavingsThreshold: householdData.household.settings?.additionalStopSavingsThreshold ?? 10,
        priceFreshnessDays: householdData.household.settings?.priceFreshnessDays ?? 30,
        strictPriceReview: householdData.household.settings?.strictPriceReview ?? false,
        barcodeAutoAccept: householdData.household.settings?.barcodeAutoAccept ?? false
      });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to load household'), { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const roster = useMemo<RosterRow[]>(() => {
    if (!data) return [];
    const members = new Map(data.members.map((member) => [member._id, member]));
    const linkedMemberIds = new Set<string>();
    const rows: RosterRow[] = data.people.filter((person) => person.active !== false).map((person) => {
      const member = person.userId ? members.get(String(person.userId)) ?? null : null;
      if (member) linkedMemberIds.add(member._id);
      return {
        key: person._id,
        person,
        member,
        name: person.displayName?.trim() || preferredName(member)
      };
    });
    data.members.forEach((member) => {
      if (linkedMemberIds.has(member._id)) return;
      rows.push({ key: `member-${member._id}`, person: null, member, name: preferredName(member) });
    });
    return rows.sort((a, b) => {
      if (Boolean(a.member) !== Boolean(b.member)) return a.member ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [data]);

  const saveHouseholdName = async (event: FormEvent) => {
    event.preventDefault();
    if (!isOwner || offline || renameSaving || !householdName.trim()) return;
    setRenameSaving(true);
    try {
      await renameHousehold(householdName.trim());
      await Promise.all([refresh(), reload()]);
      showToast('Household renamed', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to rename household'), { tone: 'error' });
    } finally {
      setRenameSaving(false);
    }
  };

  const addPerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin || offline || addingPerson || !newPersonName.trim()) return;
    setAddingPerson(true);
    try {
      await addHouseholdPerson(newPersonName.trim());
      setNewPersonName('');
      await refresh();
      showToast('Person added', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to add person'), { tone: 'error' });
    } finally {
      setAddingPerson(false);
    }
  };

  const savePersonName = async (event: FormEvent, person: HouseholdPerson) => {
    event.preventDefault();
    if (offline || rosterBusyId || !editingPersonName.trim()) return;
    setRosterBusyId(person._id);
    try {
      await updateHouseholdPerson(person._id, editingPersonName.trim());
      setEditingPersonId(null);
      await Promise.all([refresh(), String(person.userId || '') === currentUserId ? reload() : Promise.resolve()]);
      showToast('Preferred name updated', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to update preferred name'), { tone: 'error' });
    } finally {
      setRosterBusyId(null);
    }
  };

  const changeRole = async (member: HouseholdMember, role: 'admin' | 'member') => {
    const makeAdmin = role === 'admin';
    const approved = await confirm({
      title: makeAdmin ? `Make ${preferredName(member)} an Admin?` : `Remove ${preferredName(member)}’s Admin access?`,
      message: makeAdmin
        ? 'Admins can manage household settings, stores, products, and invites.'
        : 'They will keep household access as a Member but will no longer manage household settings.',
      confirmLabel: makeAdmin ? 'Make Admin' : 'Remove Admin'
    });
    if (!approved) return;
    setRosterBusyId(member._id);
    try {
      await updateMemberRole(member._id, role);
      await refresh();
      showToast(makeAdmin ? 'Admin access added' : 'Admin access removed', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to update role'), { tone: 'error' });
    } finally {
      setRosterBusyId(null);
    }
  };

  const removeAccess = async (member: HouseholdMember) => {
    const approved = await confirm({
      title: `Remove ${preferredName(member)}’s household access?`,
      message: 'They will no longer be able to sign in to this household. Shared shopping history, Pantry data, and household records stay in Provista.',
      confirmLabel: 'Remove access',
      danger: true
    });
    if (!approved) return;
    setRosterBusyId(member._id);
    try {
      await removeMember(member._id);
      await refresh();
      showToast('Household access removed', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to remove household access'), { tone: 'error' });
    } finally {
      setRosterBusyId(null);
    }
  };

  const removePlanningPerson = async (person: HouseholdPerson) => {
    const approved = await confirm({
      title: `Remove ${person.displayName} from planning?`,
      message: 'They will stop appearing as a planning-only household person. Existing meal history is not deleted.',
      confirmLabel: 'Remove person',
      danger: true
    });
    if (!approved) return;
    setRosterBusyId(person._id);
    try {
      await removeHouseholdPerson(person._id);
      await refresh();
      showToast('Person removed', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to remove person'), { tone: 'error' });
    } finally {
      setRosterBusyId(null);
    }
  };

  const showInvite = async () => {
    if (inviteLoading || offline) return;
    setInviteLoading(true);
    try {
      setInvite(await loadInvite());
      setInviteVersion((value) => value + 1);
    } catch (error) {
      showToast(errorMessage(error, 'Failed to load invite'), { tone: 'error' });
    } finally {
      setInviteLoading(false);
    }
  };

  const refreshInvite = async () => {
    if (inviteLoading || offline) return;
    setInviteLoading(true);
    try {
      setInvite(await regenerateInvite());
      setInviteVersion((value) => value + 1);
      showToast('New invite code created', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to create invite'), { tone: 'error' });
    } finally {
      setInviteLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteCode);
      showToast('Invite code copied', { tone: 'success' });
    } catch {
      showToast(`Invite code: ${invite.inviteCode}`);
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin || offline || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const result = await updateHouseholdSettings({
        usualStoreId: settings.usualStoreId || null,
        additionalStopSavingsThreshold: Number(settings.additionalStopSavingsThreshold),
        priceFreshnessDays: Number(settings.priceFreshnessDays),
        strictPriceReview: Boolean(settings.strictPriceReview)
      });
      setSettings((current) => ({ ...current, ...result.settings }));
      showToast('Shopping defaults saved', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to save shopping defaults'), { tone: 'error' });
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveBarcodeSetting = async (checked: boolean) => {
    if (offline || settingsSaving) return;
    const previous = Boolean(settings.barcodeAutoAccept);
    setSettings((current) => ({ ...current, barcodeAutoAccept: checked }));
    setSettingsSaving(true);
    try {
      await updateHouseholdSettings({ barcodeAutoAccept: checked });
      showToast('Barcode setting saved', { tone: 'success' });
    } catch (error) {
      setSettings((current) => ({ ...current, barcodeAutoAccept: previous }));
      showToast(errorMessage(error, 'Failed to save barcode setting'), { tone: 'error' });
    } finally {
      setSettingsSaving(false);
    }
  };

  const removeHousehold = async (event: FormEvent) => {
    event.preventDefault();
    const actualName = data?.household.name ?? '';
    if (!isOwner || offline || deleting || deleteName.trim() !== actualName || !deletePassword) {
      if (deleteName.trim() && deleteName.trim() !== actualName) showToast('Household name does not match', { tone: 'error' });
      return;
    }
    const approved = await confirm({
      title: `Delete ${actualName} and all household data?`,
      message: 'This permanently deletes household prices, products, stores, Pantry, List, meal planning, and shared records. Member accounts are unlinked. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true
    });
    if (!approved) return;
    setDeleting(true);
    try {
      await deleteHousehold(deletePassword);
      localStorage.removeItem('provista_auth');
      window.location.assign('/');
    } catch (error) {
      showToast(errorMessage(error, 'Failed to delete household'), { tone: 'error' });
      setDeleting(false);
    }
  };

  if (loading) {
    return <section className="more-page"><p className="more-muted" role="status">Loading household…</p></section>;
  }
  if (!data) {
    return <section className="more-page"><div className="more-status-card">Household information is unavailable.</div></section>;
  }

  const usualStoreName = stores.find((store) => store._id === String(settings.usualStoreId || ''))?.name || 'Inferred from price history';

  return (
    <section className="more-page" aria-labelledby="household-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}>
          <span aria-hidden="true">←</span> More
        </button>
        <p className="more-eyebrow">Shared settings</p>
        <h1 id="household-title">Household</h1>
        <p>Keep people, access, invitations, and shopping defaults in one place.</p>
      </header>

      {offline && <div className="more-status-card" role="status">Using cached household access. Reconnect to make changes.</div>}

      <div className="more-settings-stack">
        <form className="more-settings-card" onSubmit={saveHouseholdName}>
          <div>
            <h2>Household name</h2>
            <p>{isOwner ? 'Owners can rename the shared household.' : 'Only the household Owner can change this name.'}</p>
          </div>
          <label className="more-field">
            <span>Name</span>
            <input value={householdName} onChange={(event) => setHouseholdName(event.target.value)} readOnly={!isOwner} disabled={offline || renameSaving} />
          </label>
          {isOwner && <button type="submit" className="shell-button shell-button-primary" disabled={offline || renameSaving || !householdName.trim()}>{renameSaving ? 'Saving…' : 'Save name'}</button>}
        </form>

        <section className="more-settings-card" aria-labelledby="roster-title">
          <div className="more-section-heading-row">
            <div>
              <h2 id="roster-title">Our household</h2>
              <p>“Can sign in” means the person has account access. Planning-only people can appear in meals without an account.</p>
            </div>
          </div>

          <div className="more-record-list">
            {roster.map((row) => {
              const isMe = row.member?._id === currentUserId;
              const busy = rosterBusyId === (row.person?._id || row.member?._id);
              const canChangeRole = isOwner && row.member && !isMe && row.member.role !== 'owner';
              const canRemoveAccess = isAdmin && row.member && !isMe && row.member.role !== 'owner' && (isOwner || row.member.role === 'member');
              return (
                <div className="more-record-card" key={row.key}>
                  <div className="more-roster-row">
                    <span className="more-avatar" aria-hidden="true">{row.name.charAt(0).toUpperCase()}</span>
                    <div className="more-roster-copy">
                      <strong>{row.name}{isMe ? ' (you)' : ''}</strong>
                      <small>{row.member ? `${roleLabel(row.member.role)} · Can sign in` : 'Planning only'}</small>
                    </div>
                  </div>

                  {editingPersonId === row.person?._id ? (
                    <form className="more-inline-form" onSubmit={(event) => row.person && void savePersonName(event, row.person)}>
                      <label className="more-field">
                        <span>Preferred name</span>
                        <input value={editingPersonName} onChange={(event) => setEditingPersonName(event.target.value)} maxLength={60} required disabled={busy || offline} />
                      </label>
                      <div className="more-inline-actions">
                        <button type="button" className="shell-button shell-button-secondary" onClick={() => setEditingPersonId(null)} disabled={busy}>Cancel</button>
                        <button type="submit" className="shell-button shell-button-primary" disabled={busy || offline || !editingPersonName.trim()}>Save name</button>
                      </div>
                    </form>
                  ) : isAdmin && row.person ? (
                    <div className="more-inline-actions">
                      <button type="button" className="shell-button shell-button-secondary" onClick={() => { setEditingPersonId(row.person?._id ?? null); setEditingPersonName(row.name); }} disabled={busy || offline}>Edit name</button>
                      {canChangeRole && row.member?.role === 'member' && <button type="button" className="shell-button shell-button-secondary" onClick={() => row.member && void changeRole(row.member, 'admin')} disabled={busy || offline}>Make Admin</button>}
                      {canChangeRole && row.member?.role === 'admin' && <button type="button" className="shell-button shell-button-secondary" onClick={() => row.member && void changeRole(row.member, 'member')} disabled={busy || offline}>Remove Admin</button>}
                      {canRemoveAccess && <button type="button" className="shell-button shell-button-danger" onClick={() => row.member && void removeAccess(row.member)} disabled={busy || offline}>Remove access</button>}
                      {!row.member && <button type="button" className="shell-button shell-button-danger" onClick={() => row.person && void removePlanningPerson(row.person)} disabled={busy || offline}>Remove person</button>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <form className="more-inline-form more-add-person" onSubmit={addPerson}>
              <label className="more-field">
                <span>Add a planning-only person</span>
                <input value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} maxLength={60} placeholder="Preferred name" disabled={offline || addingPerson} />
              </label>
              <button type="submit" className="shell-button shell-button-primary" disabled={offline || addingPerson || !newPersonName.trim()}>{addingPerson ? 'Adding…' : 'Add person'}</button>
            </form>
          )}
        </section>

        {isAdmin && (
          <section className="more-settings-card" aria-labelledby="invite-title">
            <div>
              <h2 id="invite-title">Invite household members</h2>
              <p>Share a temporary code when someone needs their own Provista sign-in.</p>
            </div>
            {!invite ? (
              <button type="button" className="shell-button shell-button-secondary" onClick={() => void showInvite()} disabled={offline || inviteLoading}>{inviteLoading ? 'Loading…' : 'Show invite'}</button>
            ) : (
              <div className="more-invite-panel">
                <div>
                  <span className="more-invite-label">Invite code</span>
                  <strong className="more-invite-code">{invite.inviteCode}</strong>
                  <small>Expires {new Date(invite.expiresAt).toLocaleString()}</small>
                </div>
                <img src={`/api/household/invite/qr?v=${inviteVersion}`} width="150" height="150" alt={`QR code for household invite ${invite.inviteCode}`} />
                <div className="more-inline-actions">
                  <button type="button" className="shell-button shell-button-secondary" onClick={() => void copyInvite()}>Copy code</button>
                  <button type="button" className="shell-button shell-button-secondary" onClick={() => void refreshInvite()} disabled={offline || inviteLoading}>{inviteLoading ? 'Creating…' : 'Create new code'}</button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="more-settings-card" aria-labelledby="shopping-defaults-title">
          <div>
            <h2 id="shopping-defaults-title">Shopping defaults</h2>
            <p>{isAdmin ? 'Keep normal shopping behavior simple and move uncommon safeguards into Advanced.' : `Usual store: ${usualStoreName}. Another stop is suggested above $${Number(settings.additionalStopSavingsThreshold).toFixed(2)} in estimated savings.`}</p>
          </div>

          {isAdmin && (
            <form className="more-inline-form" onSubmit={saveSettings}>
              <label className="more-field">
                <span>Usual store</span>
                <select value={settings.usualStoreId ?? ''} onChange={(event) => setSettings((current) => ({ ...current, usualStoreId: event.target.value || null }))} disabled={offline || settingsSaving}>
                  <option value="">Infer from price history</option>
                  {stores.map((store) => <option value={store._id} key={store._id}>{store.name}</option>)}
                </select>
              </label>
              <label className="more-field">
                <span>Suggest another store when we’d save at least ($)</span>
                <input type="number" min="0" max="1000" step="0.01" value={settings.additionalStopSavingsThreshold} onChange={(event) => setSettings((current) => ({ ...current, additionalStopSavingsThreshold: Number(event.target.value) }))} disabled={offline || settingsSaving} />
              </label>

              <details className="more-advanced-settings">
                <summary>Advanced shopping settings</summary>
                <label className="more-field">
                  <span>Ignore prices older than… (days)</span>
                  <input type="number" min="1" max="365" step="1" value={settings.priceFreshnessDays} onChange={(event) => setSettings((current) => ({ ...current, priceFreshnessDays: Number(event.target.value) }))} disabled={offline || settingsSaving} />
                </label>
                <label className="more-check-row">
                  <input type="checkbox" checked={Boolean(settings.strictPriceReview)} onChange={(event) => setSettings((current) => ({ ...current, strictPriceReview: event.target.checked }))} disabled={offline || settingsSaving} />
                  <span><strong>Require Admin approval for shopping prices</strong><small>Advanced safeguard for households that want shopping-trip prices reviewed before approval.</small></span>
                </label>
              </details>

              <button type="submit" className="shell-button shell-button-primary" disabled={offline || settingsSaving}>{settingsSaving ? 'Saving…' : 'Save shopping defaults'}</button>
            </form>
          )}
        </section>

        {isAdmin && session?.features.barcodeScanning && (
          <section className="more-settings-card" aria-labelledby="household-barcode-title">
            <div>
              <h2 id="household-barcode-title">Barcode scanning</h2>
              <p>Choose whether confident matches are accepted automatically for household members who inherit this setting.</p>
            </div>
            <label className="more-check-row">
              <input type="checkbox" checked={Boolean(settings.barcodeAutoAccept)} onChange={(event) => void saveBarcodeSetting(event.target.checked)} disabled={offline || settingsSaving} />
              <span>Auto-accept confident barcode matches</span>
            </label>
          </section>
        )}

        {isOwner && (
          <form className="more-settings-card more-danger-zone" onSubmit={removeHousehold}>
            <div>
              <h2>Delete household</h2>
              <p>Permanently deletes household prices, products, stores, Pantry, List, planning, and shared records. Member accounts are unlinked.</p>
            </div>
            <label className="more-field">
              <span>Type <strong>{data.household.name}</strong> to confirm</span>
              <input value={deleteName} onChange={(event) => setDeleteName(event.target.value)} autoComplete="off" disabled={offline || deleting} />
            </label>
            <label className="more-field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} disabled={offline || deleting} />
            </label>
            <button type="submit" className="shell-button shell-button-danger" disabled={offline || deleting || !deletePassword || deleteName.trim() !== data.household.name}>{deleting ? 'Deleting…' : 'Delete household & all data'}</button>
          </form>
        )}
      </div>
    </section>
  );
}
