import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import { createStore, loadStores, updateShoppingListItem } from './api';
import { entityId, productName, type ShoppingListItem, type StoreRef } from './types';

const listQueryKey = ['shopping-list'] as const;
const NEW_STORE_VALUE = '__new_store__';

interface StorePreferenceDialogProps {
  item: ShoppingListItem;
  onClose: () => void;
}

export function StorePreferenceDialog({ item, onClose }: StorePreferenceDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: loadStores });
  const [storeId, setStoreId] = useState(entityId(item.storeId));
  const [addingStore, setAddingStore] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const newStoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => selectRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  const updatePreferenceCache = (selectedStore: StoreRef | null) => {
    queryClient.setQueryData<ShoppingListItem[]>(listQueryKey, current =>
      current?.map(entry => entry._id === item._id
        ? { ...entry, storeId: selectedStore }
        : entry) || []
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || addingStore) return;
    setSaving(true);
    setError('');

    const previous = queryClient.getQueryData<ShoppingListItem[]>(listQueryKey) || [];
    const selectedStore = (storesQuery.data || []).find(store => store._id === storeId) || null;
    updatePreferenceCache(selectedStore);

    try {
      const result = await updateShoppingListItem(item._id, { storeId: storeId || null }, item);
      showToast(result.queued
        ? 'Store preference saved offline. It will sync when you reconnect.'
        : storeId
          ? `Preferred store set to ${selectedStore?.name || 'selected store'}`
          : 'Store preference cleared',
      { tone: 'success' });
      onClose();
      if (!result.queued) void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch (saveError) {
      console.error(saveError);
      queryClient.setQueryData(listQueryKey, previous);
      setError(saveError instanceof Error ? saveError.message : 'Could not save that store preference.');
    } finally {
      setSaving(false);
    }
  };

  const createAndSelectStore = async () => {
    const name = newStoreName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError('');
    const previous = queryClient.getQueryData<ShoppingListItem[]>(listQueryKey) || [];

    try {
      const store = await createStore(name);
      queryClient.setQueryData<StoreRef[]>(['stores'], current =>
        [...(current || []).filter(entry => entry._id !== store._id), store]
          .sort((left, right) => left.name.localeCompare(right.name))
      );
      setStoreId(store._id);
      updatePreferenceCache(store);
      await updateShoppingListItem(item._id, { storeId: store._id }, item);
      showToast(`${store.name} added and selected`, { tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      onClose();
    } catch (createError) {
      console.error(createError);
      queryClient.setQueryData(listQueryKey, previous);
      setError(createError instanceof Error ? createError.message : 'Could not add that store. Try again.');
      window.setTimeout(() => newStoreRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  };

  const handleStoreChange = (value: string) => {
    if (value === NEW_STORE_VALUE) {
      setAddingStore(true);
      setError('');
      window.setTimeout(() => newStoreRef.current?.focus(), 0);
      return;
    }
    setStoreId(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (addingStore && !saving) {
        setAddingStore(false);
        setNewStoreName('');
        window.setTimeout(() => selectRef.current?.focus(), 0);
      } else if (!saving) {
        onClose();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="react-list-modal" role="dialog" aria-modal="true" aria-labelledby="react-store-preference-title" onKeyDown={handleKeyDown}>
        <form onSubmit={save}>
          <div className="react-list-modal-heading">
            <div>
              <p className="react-list-eyebrow">Planning hint</p>
              <h2 id="react-store-preference-title">Store preference</h2>
            </div>
            <button type="button" className="react-list-modal-close" aria-label="Close Store preference" disabled={saving} onClick={onClose}>✕</button>
          </div>
          <p className="react-list-modal-help">Prefer where to buy {productName(item)} next time. Where you are shopping right now stays unchanged.</p>

          {!addingStore ? (
            <label>
              <span>Prefer to buy this at</span>
              <select
                ref={selectRef}
                value={storeId}
                onChange={event => handleStoreChange(event.target.value)}
                disabled={storesQuery.isPending || saving}
              >
                <option value="">Any store</option>
                {(storesQuery.data || []).map(store => <option key={store._id} value={store._id}>{store.name}</option>)}
                <option value={NEW_STORE_VALUE}>Another store…</option>
              </select>
            </label>
          ) : (
            <div className="react-list-inline-create">
              <label htmlFor="react-new-preferred-store">
                <span>Store name</span>
                <input
                  ref={newStoreRef}
                  id="react-new-preferred-store"
                  value={newStoreName}
                  onChange={event => setNewStoreName(event.target.value)}
                  autoComplete="organization"
                  placeholder="e.g. Neighborhood Market"
                  disabled={saving}
                />
              </label>
              <small>Only the name is needed now. You can add address details later if they become useful.</small>
            </div>
          )}

          {storesQuery.isError && !addingStore && <div className="react-list-inline-error" role="alert">Could not load household stores.</div>}
          {error && <div className="react-list-inline-error" role="alert">{error}</div>}

          <div className="react-list-modal-actions">
            {addingStore ? (
              <>
                <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={() => {
                  setAddingStore(false);
                  setNewStoreName('');
                  setError('');
                  window.setTimeout(() => selectRef.current?.focus(), 0);
                }}>Back</button>
                <button type="button" className="shell-button shell-button-primary" disabled={saving || !newStoreName.trim()} onClick={() => void createAndSelectStore()}>
                  {saving ? 'Adding…' : 'Add and select'}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={onClose}>Cancel</button>
                <button type="submit" className="shell-button shell-button-primary" disabled={saving || storesQuery.isPending || storesQuery.isError}>
                  {saving ? 'Saving…' : 'Save preference'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
