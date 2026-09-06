import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import { createStore, deleteStore, loadStores, updateStore, type StoreRecord } from './settingsApi';
import './more.css';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function StoresPage() {
  const navigate = useNavigate();
  const { isAdmin, session } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const offline = Boolean(session?.offlineSession);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setStores(await loadStores());
    } catch (error) {
      showToast(errorMessage(error, 'Failed to load stores'), { tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [isAdmin]);

  const addStore = async (event: FormEvent) => {
    event.preventDefault();
    if (offline || creating || !newName.trim()) return;
    setCreating(true);
    try {
      const created = await createStore({ name: newName.trim(), location: newLocation.trim() || undefined });
      setStores((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewLocation('');
      showToast('Store added', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to add store'), { tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (store: StoreRecord) => {
    setEditingId(store._id);
    setEditName(store.name);
    setEditLocation(store.location ?? '');
  };

  const saveStore = async (event: FormEvent, id: string) => {
    event.preventDefault();
    if (offline || savingId || !editName.trim()) return;
    setSavingId(id);
    try {
      const updated = await updateStore(id, { name: editName.trim(), location: editLocation.trim() });
      setStores((current) => current.map((store) => store._id === id ? updated : store).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(null);
      showToast('Store updated', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to update store'), { tone: 'error' });
    } finally {
      setSavingId(null);
    }
  };

  const removeStore = async (store: StoreRecord) => {
    if (offline) return;
    const approved = await confirm({
      title: `Delete ${store.name}?`,
      message: 'The store will no longer be available for new shopping and price entries. Existing household history is preserved.',
      confirmLabel: 'Delete store',
      cancelLabel: 'Keep store',
      danger: true
    });
    if (!approved) return;
    setSavingId(store._id);
    try {
      await deleteStore(store._id);
      setStores((current) => current.filter((entry) => entry._id !== store._id));
      if (editingId === store._id) setEditingId(null);
      showToast('Store deleted', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to delete store'), { tone: 'error' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="more-page" aria-labelledby="stores-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}>
          <span aria-hidden="true">←</span> More
        </button>
        <p className="more-eyebrow">Household settings</p>
        <h1 id="stores-title">Stores</h1>
        <p>Keep the shopping locations your household actually uses easy to recognize.</p>
      </header>

      {!isAdmin ? (
        <div className="more-status-card" role="status">
          An Owner or Admin manages household stores.
        </div>
      ) : (
        <div className="more-settings-stack">
          {offline && <div className="more-status-card" role="status">Reconnect to change stores.</div>}

          <form className="more-settings-card" onSubmit={addStore}>
            <div>
              <h2>Add a store</h2>
              <p>Use the name you expect to see while building and finishing the shopping list.</p>
            </div>
            <div className="more-field-grid">
              <label className="more-field">
                <span>Store name</span>
                <input value={newName} onChange={(event) => setNewName(event.target.value)} required disabled={offline || creating} placeholder="e.g. Fred Meyer" />
              </label>
              <label className="more-field">
                <span>Location <small>(optional)</small></span>
                <input value={newLocation} onChange={(event) => setNewLocation(event.target.value)} disabled={offline || creating} placeholder="e.g. Hawthorne" />
              </label>
            </div>
            <button type="submit" className="shell-button shell-button-primary" disabled={offline || creating || !newName.trim()}>
              {creating ? 'Adding…' : 'Add store'}
            </button>
          </form>

          <section className="more-settings-card" aria-labelledby="stores-list-title">
            <div>
              <h2 id="stores-list-title">Shopping locations</h2>
              <p>Edit a store when the household needs a clearer name or location.</p>
            </div>
            {loading ? (
              <p className="more-muted" role="status">Loading stores…</p>
            ) : stores.length === 0 ? (
              <p className="more-muted">No stores yet.</p>
            ) : (
              <div className="more-record-list">
                {stores.map((store) => editingId === store._id ? (
                  <form className="more-record-card" key={store._id} onSubmit={(event) => void saveStore(event, store._id)}>
                    <div className="more-field-grid">
                      <label className="more-field">
                        <span>Store name</span>
                        <input value={editName} onChange={(event) => setEditName(event.target.value)} required disabled={offline || savingId === store._id} />
                      </label>
                      <label className="more-field">
                        <span>Location</span>
                        <input value={editLocation} onChange={(event) => setEditLocation(event.target.value)} disabled={offline || savingId === store._id} />
                      </label>
                    </div>
                    <div className="more-inline-actions">
                      <button type="button" className="shell-button shell-button-secondary" onClick={() => setEditingId(null)} disabled={savingId === store._id}>Cancel</button>
                      <button type="submit" className="shell-button shell-button-primary" disabled={offline || savingId === store._id || !editName.trim()}>
                        {savingId === store._id ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="shell-button shell-button-danger" onClick={() => void removeStore(store)} disabled={offline || savingId === store._id}>Delete</button>
                    </div>
                  </form>
                ) : (
                  <div className="more-record-card more-record-row" key={store._id}>
                    <div>
                      <strong>{store.name}</strong>
                      {store.location && <small>{store.location}</small>}
                    </div>
                    <button type="button" className="shell-button shell-button-secondary" onClick={() => startEdit(store)} disabled={offline}>Edit</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
