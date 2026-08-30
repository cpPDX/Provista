import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import { loadStores, updateShoppingListItem } from './api';
import { entityId, productName, type ShoppingListItem } from './types';

const listQueryKey = ['shopping-list'] as const;

interface StorePreferenceDialogProps {
  item: ShoppingListItem;
  onClose: () => void;
}

export function StorePreferenceDialog({ item, onClose }: StorePreferenceDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: loadStores });
  const [storeId, setStoreId] = useState(entityId(item.storeId));
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    window.setTimeout(() => selectRef.current?.focus(), 0);
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);

    const previous = queryClient.getQueryData<ShoppingListItem[]>(listQueryKey) || [];
    const selectedStore = (storesQuery.data || []).find(store => store._id === storeId) || null;
    queryClient.setQueryData<ShoppingListItem[]>(listQueryKey, current =>
      current?.map(entry => entry._id === item._id
        ? { ...entry, storeId: selectedStore }
        : entry) || []
    );

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
    } catch (error) {
      console.error(error);
      queryClient.setQueryData(listQueryKey, previous);
      showToast('Could not save that store preference.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')];
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
    <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="react-list-modal" role="dialog" aria-modal="true" aria-labelledby="react-store-preference-title" onKeyDown={handleKeyDown}>
        <form onSubmit={save}>
          <div className="react-list-modal-heading">
            <div>
              <p className="react-list-eyebrow">Planning hint</p>
              <h2 id="react-store-preference-title">Store preference</h2>
            </div>
            <button type="button" className="react-list-modal-close" aria-label="Close Store preference" onClick={onClose}>✕</button>
          </div>
          <p className="react-list-modal-help">Prefer where to buy {productName(item)}. Finish shopping still records where you actually purchased it.</p>
          <label>
            <span>Prefer to buy this at</span>
            <select ref={selectRef} value={storeId} onChange={event => setStoreId(event.target.value)} disabled={storesQuery.isPending || saving}>
              <option value="">Any store</option>
              {(storesQuery.data || []).map(store => <option key={store._id} value={store._id}>{store.name}</option>)}
            </select>
          </label>
          {storesQuery.isError && <div className="react-list-inline-error" role="alert">Could not load household stores.</div>}
          <div className="react-list-modal-actions">
            <button type="button" className="shell-button shell-button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="shell-button shell-button-primary" disabled={saving || storesQuery.isPending || storesQuery.isError}>
              {saving ? 'Saving…' : 'Save preference'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
