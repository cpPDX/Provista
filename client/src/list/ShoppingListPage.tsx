import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnlineStatus } from '../app/useOnlineStatus';
import {
  completeFirstAction,
  goBackInOnboarding,
  loadOnboarding,
  onboardingQueryKey
} from '../onboarding/api';
import { useConfirm } from '../shell/DialogProvider';
import { useDirtyState } from '../shell/DirtyStateProvider';
import { useToast } from '../shell/ToastProvider';
import { deleteShoppingListItem, loadShoppingList, updateShoppingListItem } from './api';
import { useShoppingCheckout } from './checkout';
import { ListItemContextControls } from './ListItemContextControls';
import { ListItemEditDialog } from './ListItemEditDialog';
import { RapidCapture } from './RapidCapture';
import { StorePreferenceDialog } from './StorePreferenceDialog';
import { StoreSectionControl, useStoreSections } from './storeSections';
import { processShoppingQueue } from './storage';
import {
  currentShoppingStoreId,
  entityId,
  intendedPurchaseQuantity,
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
const EMPTY_ITEMS: ShoppingListItem[] = [];

interface CheckSync {
  serverChecked: boolean;
  serverShoppingStoreId: string | null;
  desiredChecked: boolean;
  desiredShoppingStoreId: string | null;
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
    if (entityId(item.shoppingStoreId) === id && item.shoppingStoreId && typeof item.shoppingStoreId !== 'string') return item.shoppingStoreId.name;
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
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { requestNavigation } = useDirtyState();
  const { showToast } = useToast();
  const online = useOnlineStatus();
  const listQuery = useQuery({ queryKey, queryFn: loadShoppingList });
  const onboardingQuery = useQuery({ queryKey: onboardingQueryKey, queryFn: loadOnboarding });
  const [storeFilter, setStoreFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [storePreferenceItem, setStorePreferenceItem] = useState<ShoppingListItem | null>(null);
  const [detailItem, setDetailItem] = useState<ShoppingListItem | null>(null);
  const [quantityItem, setQuantityItem] = useState<ShoppingListItem | null>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const checkSync = useRef(new Map<string, CheckSync>());

  const items = listQuery.data || EMPTY_ITEMS;
  const checkedItems = items.filter(item => item.checked);
  const resolvedDetailItem = detailItem
    ? items.find(item => item._id === detailItem._id) || detailItem
    : null;
  const storeSections = useStoreSections(items);
  const searchParams = new URLSearchParams(location.search);
  const fromPlan = searchParams.get('from') === 'plan';
  const planDetailName = searchParams.get('detail')?.trim() || '';
  const planDetailQuantity = Math.max(1, Number(searchParams.get('quantity')) || 1);
  const initialPlanDetail = fromPlan && planDetailName
    ? { name: planDetailName, quantity: planDetailQuantity }
    : null;
  const onboardingActive = Boolean(
    onboardingQuery.data?.required &&
    onboardingQuery.data.firstAction === 'list' &&
    onboardingQuery.data.step === 'first_action'
  );

  useEffect(() => {
    if (!checkedItems.length) {
      setActiveStoreId(null);
      return;
    }
    setActiveStoreId(current => current || inferActiveStore(checkedItems));
  }, [checkedItems.length]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('focus') !== 'rapid-list-input') return;
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('#react-rapid-list-input')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.search]);

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

  useEffect(() => {
    if (!resolvedDetailItem) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => detailCloseRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailItem(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [resolvedDetailItem?._id]);

  const handleListChanged = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });
    if (!onboardingActive) return;

    try {
      const next = await completeFirstAction();
      queryClient.setQueryData(onboardingQueryKey, next);
      showToast('Your shopping list has a start. Home is ready.', { tone: 'success', durationMs: 4500 });
      navigate('/app', { replace: true });
    } catch (error) {
      console.info('Onboarding completion is not ready yet:', error);
    }
  };

  const changeFirstAction = async () => {
    try {
      const next = await goBackInOnboarding();
      queryClient.setQueryData(onboardingQueryKey, next);
      navigate('/app', { replace: true });
    } catch (error) {
      console.error(error);
      showToast('Could not change the first action.', { tone: 'error' });
    }
  };

  const updateCheckedCache = (id: string, checked: boolean, shoppingStoreId: string | null) => {
    queryClient.setQueryData<ShoppingListItem[]>(queryKey, current =>
      current?.map(item => item._id === id
        ? {
            ...item,
            checked,
            shoppingStoreId: checked ? shoppingStoreId : null,
            actualPurchasedQuantity: checked
              ? (item.actualPurchasedQuantity ?? intendedPurchaseQuantity(item))
              : null
          }
        : item) || []
    );
  };

  const flushCheck = async (id: string): Promise<boolean> => {
    const sync = checkSync.current.get(id);
    if (!sync || sync.processing) return true;
    sync.processing = true;
    let queued = false;

    try {
      while (
        sync.serverChecked !== sync.desiredChecked ||
        sync.serverShoppingStoreId !== sync.desiredShoppingStoreId
      ) {
        const target = sync.desiredChecked;
        const targetStoreId = target ? sync.desiredShoppingStoreId : null;
        const snapshot = queryClient.getQueryData<ShoppingListItem[]>(queryKey)?.find(item => item._id === id);
        if (!snapshot) throw new Error('Shopping-list item is no longer available');
        const result = await updateShoppingListItem(id, {
          checked: target,
          shoppingStoreId: targetStoreId
        }, snapshot);
        queued ||= result.queued;
        sync.serverChecked = target;
        sync.serverShoppingStoreId = targetStoreId;
        queryClient.setQueryData<ShoppingListItem[]>(queryKey, current =>
          current?.map(item => item._id === id ? { ...item, ...result.data } : item) || []
        );
      }
      checkSync.current.delete(id);
      if (queued) showToast('Saved offline. Will sync when you reconnect.');
      return true;
    } catch (error) {
      updateCheckedCache(id, sync.serverChecked, sync.serverShoppingStoreId);
      checkSync.current.delete(id);
      console.error(error);
      showToast('Could not save that item. Your check-off was rolled back.', { tone: 'error', durationMs: 4000 });
      return false;
    } finally {
      sync.processing = false;
    }
  };

  const handleCheck = async (item: ShoppingListItem, checked: boolean) => {
    let shoppingStoreId: string | null = checked
      ? (activeStoreId || plannedStoreId(item) || usualStoreId(items) || null)
      : null;

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
        shoppingStoreId = activeStoreId;
      }
    }

    let sync = checkSync.current.get(item._id);
    if (!sync) {
      sync = {
        serverChecked: Boolean(item.checked),
        serverShoppingStoreId: currentShoppingStoreId(item) || null,
        desiredChecked: Boolean(item.checked),
        desiredShoppingStoreId: currentShoppingStoreId(item) || null,
        processing: false
      };
      checkSync.current.set(item._id, sync);
    }
    sync.desiredChecked = checked;
    sync.desiredShoppingStoreId = shoppingStoreId;
    updateCheckedCache(item._id, checked, shoppingStoreId);

    if (checked && !activeStoreId) {
      setActiveStoreId(shoppingStoreId);
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
      if (detailItem?._id === item._id) setDetailItem(null);
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

  const reviewLowStock = () => {
    void requestNavigation(() => navigate('/app/pantry'));
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

      {onboardingActive && (
        <aside className="react-list-store-suggestion">
          <strong>First useful action: build your shopping list</strong>
          <span>Add at least one grocery you actually need. Once the new item is saved, Provista will take you to Home.</span>
          <button type="button" className="react-list-clear-filter" onClick={() => void changeFirstAction()}>Choose Plan instead</button>
        </aside>
      )}

      {fromPlan && (
        <aside className="react-list-store-suggestion react-list-plan-return">
          <strong>Adding a need from Plan</strong>
          <span>{planDetailName ? `${planDetailName} is prefilled with quantity ${planDetailQuantity}. ` : ''}Your exact day, meal, and household group are preserved.</span>
          <button type="button" className="shell-button shell-button-secondary" onClick={() => navigate('/app/plan')}>Back to Plan</button>
        </aside>
      )}

      {!online && <div className="react-list-offline" role="status">Offline · check-offs and simple List changes will sync when you reconnect.</div>}

      <RapidCapture
        items={items}
        online={online}
        storeId={activeStoreId}
        onListChanged={handleListChanged}
        initialDetail={initialPlanDetail}
        onInitialDetailResolved={() => navigate('/app/list?from=plan', { replace: true })}
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
            <button type="button" onClick={reviewLowStock}>Review low stock</button>
            <small>Barcode scanning is available directly with Add groceries so the primary capture tools stay together.</small>
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
              {storeSections.group(groupItems).map(([sectionName, sectionItems]) => (
                <div className="react-list-section-group" data-section={sectionName} key={sectionName}>
                  <div className="react-list-section-heading">
                    <h3>{sectionName}</h3>
                    <span>{sectionItems.length}</span>
                  </div>
                  {sectionItems.map(item => {
                    const price = householdPrice(item);
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
                        <button
                          type="button"
                          className="react-list-item-body react-list-item-open"
                          aria-label={`Open item details for ${productName(item)}`}
                          onClick={() => setDetailItem(item)}
                        >
                          <strong>{productName(item)}</strong>
                          <span>Buy {intendedPurchaseQuantity(item)}</span>
                          {price !== 'No recent household price' && <small>{price}</small>}
                        </button>
                        <button
                          type="button"
                          className="react-list-quantity-edit"
                          aria-label={`Edit quantity for ${productName(item)}, currently ${intendedPurchaseQuantity(item)}`}
                          onClick={() => setQuantityItem(item)}
                        >
                          {intendedPurchaseQuantity(item)}
                        </button>
                      </article>
                    );
                  })}
                </div>
              ))}
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

      {resolvedDetailItem && (
        <div className="react-list-modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setDetailItem(null);
        }}>
          <section className="react-list-modal react-list-item-detail" role="dialog" aria-modal="true" aria-labelledby="react-list-item-detail-title">
            <div className="react-list-modal-heading">
              <div>
                <p className="react-list-eyebrow">Item details</p>
                <h2 id="react-list-item-detail-title">{productName(resolvedDetailItem)}</h2>
              </div>
              <button ref={detailCloseRef} type="button" className="react-list-modal-close" aria-label="Close item details" onClick={() => setDetailItem(null)}>✕</button>
            </div>
            <div className="react-list-item-detail-content">
              {(productFor(resolvedDetailItem)?.brand || productFor(resolvedDetailItem)?.category) && (
                <p>{[productFor(resolvedDetailItem)?.brand, productFor(resolvedDetailItem)?.category].filter(Boolean).join(' · ')}</p>
              )}
              <ListItemContextControls item={resolvedDetailItem} online={online} />
              <section className="react-list-detail-section" aria-labelledby="react-list-store-detail-title">
                <h3 id="react-list-store-detail-title">Store and section</h3>
                <button
                  type="button"
                  className="react-list-store-preference"
                  aria-label={`Store preference for ${productName(resolvedDetailItem)}: ${explicitStoreName(resolvedDetailItem)}`}
                  onClick={() => setStorePreferenceItem(resolvedDetailItem)}
                >
                  Store preference: {explicitStoreName(resolvedDetailItem)}
                </button>
                {resolvedDetailItem.checked && currentShoppingStoreId(resolvedDetailItem) && (
                  <small>Current trip: {storeName(items, currentShoppingStoreId(resolvedDetailItem)) || 'selected store'}</small>
                )}
                <StoreSectionControl
                  item={resolvedDetailItem}
                  currentSection={storeSections.sectionFor(resolvedDetailItem)}
                  suggestions={storeSections.suggestions}
                />
              </section>
              <section className="react-list-detail-section" aria-labelledby="react-list-price-detail-title">
                <h3 id="react-list-price-detail-title">Price</h3>
                <div className="react-list-price-line">
                  {resolvedDetailItem.checked ? checkout.priceDecisionFor(resolvedDetailItem) : <small>{householdPrice(resolvedDetailItem)}</small>}
                </div>
              </section>
              <button type="button" className="shell-button shell-button-secondary react-list-detail-remove" onClick={() => void removeItem(resolvedDetailItem)}>Remove from list</button>
            </div>
          </section>
        </div>
      )}

      {quantityItem && (
        <ListItemEditDialog
          item={items.find(item => item._id === quantityItem._id) || quantityItem}
          onClose={() => setQuantityItem(null)}
        />
      )}
      {storePreferenceItem && (
        <StorePreferenceDialog
          item={items.find(item => item._id === storePreferenceItem._id) || storePreferenceItem}
          onClose={() => setStorePreferenceItem(null)}
        />
      )}
      {checkout.dialogs}
    </section>
  );
}
