import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import { deletePantryItem, loadPantry, updatePantryItem } from './api';
import { PantryItemDialog } from './PantryItemDialog';
import {
  exactPantryStatus,
  pantryProduct,
  pantryProductName,
  pantryUnit,
  type PantryItem,
  type PantryStockStatus
} from './types';
import './pantry.css';

const queryKey = ['pantry'] as const;
const statusLabels: Record<PantryStockStatus, string> = {
  have: 'Have',
  low: 'Running low',
  out: 'Out'
};

interface StatusSync {
  serverStatus: PantryStockStatus;
  desiredStatus: PantryStockStatus;
  processing: boolean;
  promise?: Promise<boolean>;
}

interface QuantitySync {
  serverQuantity: number;
  desiredQuantity: number;
  processing: boolean;
  promise?: Promise<boolean>;
}

type DialogState =
  | { mode: 'add'; prefill: string }
  | { mode: 'edit'; itemId: string }
  | null;

function itemMeta(item: PantryItem) {
  const product = pantryProduct(item);
  if (!product) return '';
  return [product.brand, product.size, product.category, product.isOrganic ? 'Organic' : ''].filter(Boolean).join(' · ');
}

function exactSummary(item: PantryItem) {
  const quantity = Number(item.quantity) || 0;
  const unit = pantryUnit(item);
  const quantityText = `${quantity}${unit ? ` ${unit}` : ''} left`;
  if (item.lowStockThreshold == null) return quantityText;
  return `${quantityText} · Provista marks low at ${item.lowStockThreshold}${unit ? ` ${unit}` : ''}`;
}

export function PantryPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const online = useOnlineStatus();
  const pantryQuery = useQuery({ queryKey, queryFn: loadPantry });
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const statusSync = useRef(new Map<string, StatusSync>());
  const quantitySync = useRef(new Map<string, QuantitySync>());

  const items = pantryQuery.data || [];
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(item => {
      const product = pantryProduct(item);
      return [product?.name, product?.brand, product?.category, item.notes]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [items, search]);

  const patchItem = (id: string, updater: (item: PantryItem) => PantryItem) => {
    queryClient.setQueryData<PantryItem[]>(queryKey, current =>
      current?.map(item => item._id === id ? updater(item) : item) || []
    );
  };

  const markRelatedQueriesStale = () => {
    void queryClient.invalidateQueries({
      predicate: query => query.queryKey[0] !== queryKey[0],
      refetchType: 'none'
    });
  };

  const flushStatus = async (id: string): Promise<boolean> => {
    const sync = statusSync.current.get(id);
    if (!sync || sync.processing) return true;
    sync.processing = true;

    try {
      while (sync.serverStatus !== sync.desiredStatus) {
        const target = sync.desiredStatus;
        const updated = await updatePantryItem(id, { trackingMode: 'simple', stockStatus: target });
        sync.serverStatus = target;
        patchItem(id, current => ({
          ...current,
          ...updated,
          stockStatus: sync.desiredStatus,
          quantity: sync.desiredStatus === 'out' ? 0 : Math.max(Number(updated.quantity) || Number(current.quantity) || 1, 1)
        }));
      }
      statusSync.current.delete(id);
      markRelatedQueriesStale();
      return true;
    } catch (error) {
      console.error(error);
      patchItem(id, current => ({
        ...current,
        stockStatus: sync.serverStatus,
        quantity: sync.serverStatus === 'out' ? 0 : Math.max(Number(current.quantity) || 1, 1)
      }));
      statusSync.current.delete(id);
      showToast('Could not update Pantry status. Your change was rolled back.', { tone: 'error', durationMs: 4000 });
      return false;
    } finally {
      sync.processing = false;
    }
  };

  const setStatus = (item: PantryItem, stockStatus: PantryStockStatus) => {
    if (!online) {
      showToast('Reconnect before changing Pantry.', { tone: 'error' });
      return;
    }
    if (item.trackingMode !== 'simple' || item.stockStatus === stockStatus) return;

    let sync = statusSync.current.get(item._id);
    if (!sync) {
      sync = {
        serverStatus: item.stockStatus || 'have',
        desiredStatus: item.stockStatus || 'have',
        processing: false
      };
      statusSync.current.set(item._id, sync);
    }
    sync.desiredStatus = stockStatus;
    patchItem(item._id, current => ({
      ...current,
      stockStatus,
      quantity: stockStatus === 'out' ? 0 : Math.max(Number(current.quantity) || 1, 1)
    }));
    if (!sync.processing) {
      sync.promise = flushStatus(item._id);
      void sync.promise;
    }
  };

  const flushQuantity = async (id: string): Promise<boolean> => {
    const sync = quantitySync.current.get(id);
    if (!sync || sync.processing) return true;
    sync.processing = true;

    try {
      while (sync.serverQuantity !== sync.desiredQuantity) {
        const target = sync.desiredQuantity;
        const updated = await updatePantryItem(id, { trackingMode: 'exact', quantity: target });
        sync.serverQuantity = target;
        patchItem(id, current => {
          const desired = sync.desiredQuantity;
          const next = { ...current, ...updated, quantity: desired };
          return { ...next, stockStatus: exactPantryStatus(next) };
        });
      }
      quantitySync.current.delete(id);
      markRelatedQueriesStale();
      return true;
    } catch (error) {
      console.error(error);
      patchItem(id, current => {
        const next = { ...current, quantity: sync.serverQuantity };
        return { ...next, stockStatus: exactPantryStatus(next) };
      });
      quantitySync.current.delete(id);
      showToast('Could not update Pantry quantity. Your change was rolled back.', { tone: 'error', durationMs: 4000 });
      return false;
    } finally {
      sync.processing = false;
    }
  };

  const adjustQuantity = (item: PantryItem, delta: number) => {
    if (!online) {
      showToast('Reconnect before changing Pantry.', { tone: 'error' });
      return;
    }
    if (item.trackingMode !== 'exact') return;

    let sync = quantitySync.current.get(item._id);
    if (!sync) {
      const currentQuantity = Number(item.quantity) || 0;
      sync = {
        serverQuantity: currentQuantity,
        desiredQuantity: currentQuantity,
        processing: false
      };
      quantitySync.current.set(item._id, sync);
    }

    const nextQuantity = Math.max(0, sync.desiredQuantity + delta);
    sync.desiredQuantity = nextQuantity;
    patchItem(item._id, current => {
      const next = { ...current, quantity: nextQuantity };
      return { ...next, stockStatus: exactPantryStatus(next) };
    });
    if (!sync.processing) {
      sync.promise = flushQuantity(item._id);
      void sync.promise;
    }
  };

  const removeItem = async (item: PantryItem) => {
    const name = pantryProductName(item);
    const confirmed = await confirm({
      title: 'Remove from Pantry?',
      message: `${name} will stop appearing in Pantry and low-stock reminders. This does not remove the product from your household catalog.`,
      confirmLabel: 'Remove from Pantry',
      danger: true
    });
    if (!confirmed) return;
    if (!online) {
      showToast('Reconnect before removing a Pantry item.', { tone: 'error' });
      return;
    }

    const previous = queryClient.getQueryData<PantryItem[]>(queryKey) || [];
    queryClient.setQueryData<PantryItem[]>(queryKey, current => current?.filter(entry => entry._id !== item._id) || []);
    try {
      await deletePantryItem(item._id);
      markRelatedQueriesStale();
      showToast(`${name} removed from Pantry`, { tone: 'success' });
    } catch (error) {
      console.error(error);
      queryClient.setQueryData(queryKey, previous);
      showToast('Could not remove that Pantry item.', { tone: 'error' });
    }
  };

  const handleSaved = async (saved: PantryItem) => {
    queryClient.setQueryData<PantryItem[]>(queryKey, current => {
      const existing = current || [];
      const index = existing.findIndex(item => item._id === saved._id);
      if (index < 0) return [saved, ...existing];
      return existing.map(item => item._id === saved._id ? saved : item);
    });
    const wasAdd = dialog?.mode === 'add';
    setDialog(null);
    if (wasAdd) setSearch('');
    markRelatedQueriesStale();
    showToast(wasAdd ? 'Item is now tracked in Pantry' : 'Pantry tracking updated', { tone: 'success' });
  };

  const editingItem = dialog?.mode === 'edit'
    ? items.find(item => item._id === dialog.itemId) || null
    : null;

  return (
    <section className="pantry-page" aria-labelledby="pantry-react-title">
      <div className="pantry-page-heading">
        <div>
          <p className="pantry-eyebrow">Household stock</p>
          <h1 id="pantry-react-title">Pantry</h1>
          <p id="pantry-page-help">Mark staples Running low or Out and Provista will surface them on Home and in List review.</p>
        </div>
        <button id="btn-add-inventory" type="button" className="shell-button shell-button-primary" disabled={!online} onClick={() => setDialog({ mode: 'add', prefill: search.trim() })}>
          Track item
        </button>
      </div>

      {!online && (
        <div className="pantry-offline" role="status">
          Offline — Pantry is read-only until you reconnect.
        </div>
      )}

      <div className="pantry-toolbar">
        <label htmlFor="pantry-search">Search Pantry</label>
        <div className="pantry-search-row">
          <input
            id="pantry-search"
            type="search"
            value={search}
            placeholder="Milk, rice, paper towels…"
            onChange={event => setSearch(event.target.value)}
          />
          {search && <button type="button" className="shell-button shell-button-secondary" onClick={() => setSearch('')}>Clear</button>}
        </div>
      </div>

      {pantryQuery.isPending && (
        <div className="pantry-state" aria-busy="true">
          <div className="shell-spinner" aria-hidden="true" />
          <p>Loading Pantry…</p>
        </div>
      )}

      {pantryQuery.isError && !items.length && (
        <div className="pantry-state" role="alert">
          <strong>Pantry could not load.</strong>
          <p>{online ? 'Try again to refresh your household stock.' : 'Reconnect to load Pantry on this device.'}</p>
          {online && <button type="button" className="shell-button shell-button-secondary" onClick={() => void pantryQuery.refetch()}>Try again</button>}
        </div>
      )}

      {!pantryQuery.isPending && !pantryQuery.isError && visibleItems.length === 0 && (
        <div className="pantry-empty">
          <span aria-hidden="true">🧺</span>
          {search.trim() ? (
            <>
              <strong>No Pantry items match “{search.trim()}”.</strong>
              <div className="pantry-empty-actions">
                <button type="button" className="shell-button shell-button-primary" disabled={!online} onClick={() => setDialog({ mode: 'add', prefill: search.trim() })}>
                  Track “{search.trim()}”
                </button>
                <button type="button" className="shell-button shell-button-secondary" onClick={() => setSearch('')}>Clear search</button>
              </div>
            </>
          ) : (
            <>
              <strong>Nothing tracked yet.</strong>
              <p>Track staples you want Provista to surface when they’re low.</p>
            </>
          )}
        </div>
      )}

      {visibleItems.length > 0 && (
        <div className="pantry-list" id="inventory-list">
          {visibleItems.map(item => {
            const status = item.trackingMode === 'exact' ? exactPantryStatus(item) : item.stockStatus;
            const name = pantryProductName(item);
            const meta = itemMeta(item);
            return (
              <article key={item._id} className={`pantry-card pantry-${status}`} data-inv-id={item._id} data-tracking-mode={item.trackingMode}>
                <div className="pantry-card-heading">
                  <div>
                    <h2>{name}</h2>
                    {meta && <p>{meta}</p>}
                  </div>
                  <span className="pantry-status-badge">{statusLabels[status]}</span>
                </div>

                {item.notes && <p className="pantry-card-notes">{item.notes}</p>}

                {item.trackingMode === 'simple' ? (
                  <div className="pantry-status-actions" role="group" aria-label={`Stock status for ${name}`}>
                    {(Object.keys(statusLabels) as PantryStockStatus[]).map(value => (
                      <button
                        key={value}
                        type="button"
                        className={status === value ? 'active' : undefined}
                        aria-pressed={status === value}
                        disabled={!online}
                        onClick={() => setStatus(item, value)}
                      >
                        {statusLabels[value]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="pantry-mode-help">{exactSummary(item)}</p>
                    <div className="pantry-qty-controls" aria-label={`Exact quantity for ${name}`}>
                      <button type="button" disabled={!online} onClick={() => adjustQuantity(item, -1)} aria-label={`Decrease ${name} quantity`}>−</button>
                      <span className="qty-val" aria-live="polite">{item.quantity}</span>
                      <button type="button" disabled={!online} onClick={() => adjustQuantity(item, 1)} aria-label={`Increase ${name} quantity`}>+</button>
                    </div>
                  </>
                )}

                <div className="pantry-card-actions">
                  <button type="button" className="shell-button shell-button-secondary" disabled={!online} onClick={() => setDialog({ mode: 'edit', itemId: item._id })}>
                    Edit details
                  </button>
                  {isAdmin && (
                    <button type="button" className="shell-button pantry-remove-button" disabled={!online} onClick={() => void removeItem(item)}>
                      Remove
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog?.mode === 'add' && (
        <PantryItemDialog
          mode="add"
          prefill={dialog.prefill}
          online={online}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}

      {dialog?.mode === 'edit' && editingItem && (
        <PantryItemDialog
          mode="edit"
          item={editingItem}
          online={online}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
