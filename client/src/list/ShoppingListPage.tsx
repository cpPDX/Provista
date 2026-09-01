import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import { deleteShoppingListItem, loadShoppingList, updateShoppingListItem } from './api';
import { useShoppingCheckout } from './checkout';
import { RapidCapture } from './RapidCapture';
import { StorePreferenceDialog } from './StorePreferenceDialog';
import { processShoppingQueue } from './storage';
import {
  entityId,
  plannedStoreId,
  plannedStoreName,
  preferredStoreId,
  productFor,
  productName,
  usualStoreId,
  type ShoppingListItem
} from './types';
import './list.css';

const queryKey = ['shopping-list'] as const;

interface CheckSync {
  serverChecked: boolean;
  desiredChecked: boolean;
  processing: boolean;
  promise?: Promise<boolean>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

function inferActiveStore(items: ShoppingListItem[]): string | null {
  const counts = new Map<string, number>();
  items.forEach(item => {
    const id = plannedStoreId(item);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || usualStoreId(items) || null;
}

function storeName(items: ShoppingListItem[], id: string | null): string {
  if (!id) return '';
  for (const item of items) {
    if (entityId(item.storeId) === id && item.storeId && typeof item.storeId !== 'string') return item.storeId.name;
    if (entityId(item.tripStore) === id && item.tripStore) return item.tripStore.name;
    const usual = item.priceContext?.usualStore;
    if (entityId(usual) === id && usual) return usual.name;
  }
  return '';
}

function explicitStoreName(item: ShoppingListItem): string {
  if (!item.storeId) return 'Any store';
  return typeof item.storeId === 'string' ? 'Preferred store' : item.storeId.name;
}

function householdPrice(item: ShoppingListItem): string {
  const product = productFor(item);
  const unit = product?.unit ? `/${product.unit}` : '';
  if (item.tripPrice && Number.isFinite(Number(item.tripPrice.pricePerUnit))) {
    return `Last paid ${formatCurrency(Number(item.tripPrice.pricePerUnit))}${unit}${item.tripPrice.store?.name ? ` at ${item.tripPrice.store.name}` : ''}`;
  }
  if (item.latestSeenPrice && Number.isFinite(Number(item.latestSeenPrice.pricePerUnit))) {
    return `Last paid ${formatCurrency(Number(item.latestSeenPrice.pricePerUnit))}${unit}${item.latestSeenPrice.store?.name ? ` at ${item.latestSeenPrice.store.name}` : ''} · Price may have changed`;
  }
  return 'No recent household price';
}

export function ShoppingListPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const online = useOnlineStatus();
  const listQuery = useQuery({ queryKey, queryFn: loadShoppingList });
  const [storeFilter, setStoreFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [storePreferenceItem, setStorePreferenceItem] = useState<ShoppingListItem | null>(null);
  const checkSync = useRef(new Map<string, CheckSync>());

  const items = listQuery.data || [];
  const checkedItems = items.filter(item => item.checked);

  useEffect(() => {
    if (!checkedItems.length) {
      setActiveStoreId(null);
      return;
    }
    setActiveStoreId(current => current || inferActiveStore(checkedItems));
  }, [checkedItems.length]);

  useEffect(() => {
    if (!online) return;
    void processShoppingQueue().then(result => {
      if (result.synced) {
        showToast(`${result.synced} offline List change${result.synced === 1 ? '' : 's'} synced`, { tone: 'success' });
        void queryClient.invalidateQueries({ queryKey });
      }
      if (result.failed) showToast(`${result.failed} List change${result.failed === 1 ? '' : 's'} could not sync`, { tone: 'error' });
    });
  }, [online, queryClient, showToast]);

  const updateCheckedCache = (id: string, checked: boolean) => {
    queryClient.setQueryData<ShoppingListItem[]>(queryKey, current =>
      current?.map(item => item._id === id ? { ...item, checked } : item) || []
    );
  };

  const flushCheck = async (id: string): Promise<boolean> => {
    const sync = checkSync.current.get(id);
    if (!sync || sync.processing) return true;
    sync.processing = true;
    let queued = false;

    try {
      while (sync.serverChecked !== sync.desiredChecked) {
        const target = sync.desiredChecked;
        const snapshot = queryClient.getQueryData<ShoppingListItem[]>(queryKey)?.find(item => item._id === id);
        if (!snapshot) throw new Error('Shopping-list item is no longer available');
        const result = await updateShoppingListItem(id, { checked: target }, snapshot);
        queued ||= result.queued;
        sync.serverChecked = target;
      }
      checkSync.current.delete(id);
      if (queued) showToast('Saved offline. Will sync when you reconnect.');
      return true;
    } catch (error) {
      updateCheckedCache(id, sync.serverChecked);
      checkSync.current.delete(id);
      console.error(error);
      showToast('Could not save that item. Your check-off was rolled back.', { tone: 'error', durationMs: 4000 });
      return false;
    } finally {
      sync.processing = false;
    }
  };

  const handleCheck = async (item: ShoppingListItem, checked: boolean) => {
    if (checked && activeStoreId) {
      const preferredId = preferredStoreId(item);
      if (preferredId && preferredId !== activeStoreId) {
        const preferredName = storeName(items, preferredId) || 'another store';
        const currentName = storeName(items, activeStoreId) || 'this store';
        const buyHere = await confirm({
          title: `This item is planned for ${preferredName}.`,
          message: `You’re shopping at ${currentName} now. Buy it here instead, or leave it for ${preferredName}?`,
          confirmLabel: 'Buy here instead',
          cancelLabel: `Leave for ${preferredName}`
        });
        if (!buyHere) return;
      }
    }

    let sync = checkSync.current.get(item._id);
    if (!sync) {
      sync = {
        serverChecked: Boolean(item.checked),
        desiredChecked: Boolean(item.checked),
        processing: false
      };
      checkSync.current.set(item._id, sync);
    }
    sync.desiredChecked = checked;
    updateCheckedCache(item._id, checked);

    if (checked && !activeStoreId) {
      setActiveStoreId(plannedStoreId(item) || usualStoreId(items) || null);
    } else if (!checked && checkedItems.length === 1 && checkedItems[0]?._id === item._id) {
      setActiveStoreId(null);
    }

    if (!sync.processing) {
      sync.promise = flushCheck(item._id);
      void sync.promise;
    }
  };

  const settleChecks = async () => {
    const pending = [...checkSync.current.values()].map(sync => sync.promise).filter((promise): promise is Promise<boolean> => Boolean(promise));
    if (!pending.length) return true;
    const results = await Promise.all(pending);
    return results.every(Boolean);
  };

  const checkout = useShoppingCheckout({
    items,
    online,
    activeStoreId,
    setActiveStoreId,
    settleChecks,
    onCompleted: async () => {
      await queryClient.invalidateQueries();
    }
  });

  const removeItem = async (item: ShoppingListItem) => {
    const confirmed = await confirm({
      title: 'Remove from list?',
      message: `${productName(item)} will be removed from this shopping list. Pantry and price history will not change.`,
      confirmLabel: 'Remove from list'
    });
    if (!confirmed) return;

    const previous = queryClient.getQueryData<ShoppingListItem[]>(queryKey) || [];
    queryClient.setQueryData<ShoppingListItem[]>(queryKey, current => current?.filter(entry => entry._id !== item._id) || []);
    try {
      const result = await deleteShoppingListItem(item._id);
      showToast(result.queued ? 'Removed offline. Will sync when you reconnect.' : `${productName(item)} removed from list`);
    } catch (error) {
      console.error(error);
      queryClient.setQueryData(queryKey, previous);
      showToast('Could not remove that item.', { tone: 'error' });
    }
  };

  const categories = useMemo(() => [...new Set(items.map(item => productFor(item)?.category).filter((value): value is string => Boolean(value)))].sort(), [items]);
  const stores = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(item => {
      const id = plannedStoreId(item);
      if (id) map.set(id, plannedStoreName(item));
    });
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [items]);

  const visibleItems = items.filter(item => {
    if (storeFilter && plannedStoreId(item) !== storeFilter) return false;
    if (categoryFilter && productFor(item)?.category !== categoryFilter) return false;
    return true;
  });

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingListItem[]>();
    visibleItems.forEach(item => {
      const name = plannedStoreName(item);
      const current = map.get(name) || [];
      current.push(item);
      map.set(name, current);
    });
    return [...map.entries()];
  }, [visibleItems]);

  const context = items.find(item => item.priceContext)?.priceContext;
  const savings = Number(context?.estimatedAdditionalStopSavings || 0);
  const threshold = Number(context?.savingsThreshold || 0);
  const showStoreSuggestion = Boolean(context?.additionalStore?.name && savings >= threshold);

  const openShoppingTool = (action: 'review-low-stock' | 'scan-list-item') => {
    if (action === 'review-low-stock') {
      window.location.assign('/app/pantry');
      return;
    }
    const params = new URLSearchParams({ tab: 'list', action });
    window.location.assign(`/app?${params.toString()}`);
  };

  return (
    <section className="react-list-page" aria-labelledby="react-list-title">
      <header className="react-list-heading">
        <div>
          <p className="react-list-eyebrow">Shopping</p>
          <h1 id="react-list-title">Shopping list</h1>
          <p>Check items off as you shop. Provista saves each check immediately.</p>
        </div>
      </header>

      {!online && <div className="react-list-offline" role="status">Offline · check-offs and simple List changes will sync when you reconnect.</div>}

      <RapidCapture
        items={items}
        online={online}
        onListChanged={() => queryClient.invalidateQueries({ queryKey })}
      />

      <div className="react-list-toolbar">
        <div className="react-list-controls" aria-label="List filters">
          <label>
            <span>Store</span>
            <select value={storeFilter} onChange={event => setStoreFilter(event.target.value)}>
              <option value="">All stores</option>
              {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {categories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          {(storeFilter || categoryFilter) && (
            <button type="button" className="react-list-clear-filter" onClick={() => { setStoreFilter(''); setCategoryFilter(''); }}>Clear filters</button>
          )}
        </div>
        <details className="react-list-more-tools">
          <summary>More shopping tools</summary>
          <div>
            <button type="button" onClick={() => openShoppingTool('review-low-stock')}>Review low stock</button>
            <button type="button" onClick={() => openShoppingTool('scan-list-item')}>Scan item</button>
            <small>Low-stock review now opens React Pantry. Scanner support remains on the compatibility screen until its migration work is complete.</small>
          </div>
        </details>
      </div>

      {showStoreSuggestion && (
        <aside className="react-list-store-suggestion">
          <strong>Worth another stop?</strong>
          <span>{context?.additionalStore?.name} saves about {formatCurrency(savings)} across this list.</span>
          <small>Store suggestions are planning hints. Provista records where you actually shop when you finish each stop.</small>
        </aside>
      )}

      {listQuery.isPending ? (
        <div className="react-list-state" aria-busy="true">Loading your list…</div>
      ) : listQuery.isError ? (
        <div className="react-list-state">
          <strong>Couldn’t load your shopping list</strong>
          <span>{listQuery.error instanceof Error ? listQuery.error.message : 'Try again when you’re connected.'}</span>
          <button type="button" className="shell-button shell-button-secondary" onClick={() => void listQuery.refetch()}>Try again</button>
        </div>
      ) : !items.length ? (
        <div className="react-list-state">
          <strong>Your list is empty</strong>
          <span>Add groceries above whenever they come to mind.</span>
        </div>
      ) : !visibleItems.length ? (
        <div className="react-list-state">
          <strong>No items match these filters</strong>
          <button type="button" className="shell-button shell-button-secondary" onClick={() => { setStoreFilter(''); setCategoryFilter(''); }}>Clear filters</button>
        </div>
      ) : (
        <div className="react-list-groups">
          {groups.map(([groupName, groupItems]) => (
            <section className="react-list-group" key={groupName} aria-label={`Suggested stop ${groupName}`}>
              <div className="react-list-group-heading">
                <h2>{groupName === 'Any store' ? 'No store preference' : `Suggested: ${groupName}`}</h2>
                <span>{groupItems.length} item{groupItems.length === 1 ? '' : 's'}</span>
              </div>
              {groupItems.map(item => {
                const product = productFor(item);
                return (
                  <article className={`list-item react-list-item ${item.checked ? 'checked' : ''}`} data-id={item._id} key={item._id}>
                    <button
                      type="button"
                      className="list-item-check-wrap react-list-check"
                      aria-label={`${item.checked ? 'Uncheck' : 'Mark as purchased'} ${productName(item)}`}
                      aria-pressed={item.checked}
                      onClick={() => void handleCheck(item, !item.checked)}
                    >
                      <span className={`react-list-checkbox ${item.checked ? 'checked' : ''}`} aria-hidden="true">{item.checked ? '✓' : ''}</span>
                    </button>
                    <div className="react-list-item-body">
                      <h3>{productName(item)}</h3>
                      <p>{[product?.brand, product?.category].filter(Boolean).join(' · ') || 'Grocery'} · qty {item.quantity}</p>
                      <button
                        type="button"
                        className="react-list-store-preference"
                        aria-label={`Store preference for ${productName(item)}: ${explicitStoreName(item)}`}
                        onClick={() => setStorePreferenceItem(item)}
                      >
                        Store: {explicitStoreName(item)}
                      </button>
                      {item.checked ? checkout.priceDecisionFor(item) : <small>{householdPrice(item)}</small>}
                    </div>
                    <button type="button" className="react-list-remove" aria-label={`Remove ${productName(item)} from the list`} onClick={() => void removeItem(item)}>✕</button>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {checkedItems.length > 0 && (
        <div className="react-list-cart" role="region" aria-label="Shopping progress">
          <div>
            <strong id="cart-bar-label">{checkout.cartLabel}</strong>
            <span>{checkout.cartDetail}</span>
          </div>
          <button id="btn-done-shopping" type="button" className="shell-button shell-button-primary" onClick={() => void checkout.beginCheckout()}>
            Finish shopping
          </button>
        </div>
      )}

      {storePreferenceItem && <StorePreferenceDialog item={storePreferenceItem} onClose={() => setStorePreferenceItem(null)} />}
      {checkout.dialogs}
    </section>
  );
}
