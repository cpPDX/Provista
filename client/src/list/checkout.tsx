import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import { completeShoppingTrip, loadStores, type ShoppingTripResult } from './api';
import {
  actualPurchasedQuantity,
  currentShoppingStoreId,
  entityId,
  plannedStoreId,
  productName,
  usualStoreId,
  type ShoppingListItem,
  type StoreRef
} from './types';

export type PriceDecision = 'existing' | 'updated' | 'later';

export interface CartEntry {
  name: string;
  quantity: number;
  storeId: string | null;
  plannedStoreId: string | null;
  suggestedPrice: number | null;
  price: number | null;
  priceDecision: PriceDecision;
  priceControlsExpanded: boolean;
}

interface UseShoppingCheckoutOptions {
  items: ShoppingListItem[];
  online: boolean;
  activeStoreId: string | null;
  setActiveStoreId: (id: string | null) => void;
  settleChecks: () => Promise<boolean>;
  onCompleted: (result: ShoppingTripResult) => void | Promise<void>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function knownLinePriceForStore(item: ShoppingListItem, storeId: string | null): number | null {
  if (!storeId) return null;
  const option = (item.priceOptions || []).find(price =>
    !price.isStale &&
    entityId(price.store) === storeId &&
    Number.isFinite(Number(price.pricePerUnit)) &&
    Number(price.pricePerUnit) >= 0
  );
  if (!option) return null;
  return roundCurrency(Number(option.pricePerUnit) * actualPurchasedQuantity(item));
}

function makeCartEntry(item: ShoppingListItem, storeId: string | null): CartEntry {
  const actualStoreId = currentShoppingStoreId(item) || storeId || plannedStoreId(item) || null;
  const known = knownLinePriceForStore(item, actualStoreId);
  return {
    name: productName(item),
    quantity: actualPurchasedQuantity(item),
    storeId: actualStoreId,
    plannedStoreId: plannedStoreId(item) || null,
    suggestedPrice: known,
    price: known,
    priceDecision: known === null ? 'later' : 'existing',
    priceControlsExpanded: false
  };
}

function storeName(stores: StoreRef[], items: ShoppingListItem[], id: string | null): string {
  if (!id) return '';
  const store = stores.find(candidate => candidate._id === id);
  if (store) return store.name;
  for (const item of items) {
    if (item.shoppingStoreId && typeof item.shoppingStoreId !== 'string' && item.shoppingStoreId._id === id) return item.shoppingStoreId.name;
    if (item.storeId && typeof item.storeId !== 'string' && item.storeId._id === id) return item.storeId.name;
    if (item.tripStore?._id === id) return item.tripStore.name;
    if (item.priceContext?.usualStore?._id === id) return item.priceContext.usualStore.name;
  }
  return '';
}

function compactPriceCopy(entry: CartEntry) {
  if (entry.priceDecision === 'updated' && entry.price !== null) return `Bought · ${formatCurrency(entry.price)} recorded`;
  if (entry.priceDecision === 'later') return 'Bought · price later';
  if (entry.suggestedPrice !== null) return `Bought · using recent ${formatCurrency(entry.suggestedPrice)}`;
  return 'Bought · price later';
}

function handleDialogKey(event: KeyboardEvent<HTMLDivElement>, close: () => void, closeDisabled = false) {
  if (event.key === 'Escape' && !closeDisabled) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.offsetParent !== null);
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
}

export function useShoppingCheckout({
  items,
  online,
  activeStoreId,
  setActiveStoreId,
  settleChecks,
  onCompleted
}: UseShoppingCheckoutOptions) {
  const { showToast } = useToast();
  const checkedItems = items.filter(item => item.checked);
  const storesQuery = useQuery({
    queryKey: ['stores'],
    queryFn: loadStores,
    enabled: checkedItems.length > 0
  });
  const stores = storesQuery.data || [];
  const [cartEntries, setCartEntries] = useState<Record<string, CartEntry>>({});
  const [priceEditorItemId, setPriceEditorItemId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStoreId, setCheckoutStoreId] = useState('');
  const [addToPantry, setAddToPantry] = useState(true);
  const [completing, setCompleting] = useState(false);
  const tripKey = useRef<string | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const storeSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setCartEntries(current => {
      const next: Record<string, CartEntry> = {};
      checkedItems.forEach(item => {
        const existing = current[item._id];
        if (!existing) {
          next[item._id] = makeCartEntry(item, activeStoreId || usualStoreId(items) || null);
          return;
        }

        const quantity = actualPurchasedQuantity(item);
        const storeId = currentShoppingStoreId(item) || existing.storeId;
        const updated = { ...existing, quantity, storeId };
        if (existing.priceDecision === 'existing') {
          const known = knownLinePriceForStore(item, storeId);
          updated.suggestedPrice = known;
          updated.price = known;
          if (known === null) updated.priceDecision = 'later';
        }
        next[item._id] = updated;
      });
      return next;
    });
  }, [items]);

  const applyTripStore = (storeId: string | null) => {
    setActiveStoreId(storeId);
    setCartEntries(current => {
      const next = { ...current };
      checkedItems.forEach(item => {
        const existing = next[item._id] || makeCartEntry(item, storeId);
        const entry = { ...existing };
        const known = knownLinePriceForStore(item, storeId);
        if (entry.priceDecision === 'existing') {
          entry.suggestedPrice = known;
          entry.price = known;
          if (known === null) entry.priceDecision = 'later';
        }
        entry.storeId = storeId;
        entry.quantity = actualPurchasedQuantity(item);
        entry.priceControlsExpanded = false;
        next[item._id] = entry;
      });
      return next;
    });
  };

  const updateEntry = (itemId: string, update: (entry: CartEntry) => CartEntry) => {
    setCartEntries(current => {
      const entry = current[itemId];
      if (!entry) return current;
      return { ...current, [itemId]: update(entry) };
    });
  };

  const togglePriceControls = (itemId: string) => {
    updateEntry(itemId, entry => ({ ...entry, priceControlsExpanded: !entry.priceControlsExpanded }));
  };

  const choosePriceDecision = (item: ShoppingListItem, decision: PriceDecision) => {
    const entry = cartEntries[item._id];
    if (!entry) return;
    if (decision === 'updated') {
      setPriceDraft(entry.price !== null ? String(entry.price) : entry.suggestedPrice !== null ? String(entry.suggestedPrice) : '');
      setPriceEditorItemId(item._id);
      window.setTimeout(() => priceInputRef.current?.focus(), 0);
      return;
    }
    if (decision === 'later') {
      updateEntry(item._id, current => ({
        ...current,
        price: null,
        priceDecision: 'later',
        priceControlsExpanded: false
      }));
      return;
    }
    const known = knownLinePriceForStore(item, entry.storeId || activeStoreId);
    if (known === null) {
      showToast('No recent household price is available for this store.');
      return;
    }
    updateEntry(item._id, current => ({
      ...current,
      suggestedPrice: known,
      price: known,
      priceDecision: 'existing',
      priceControlsExpanded: false
    }));
  };

  const saveUpdatedPrice = (event: FormEvent) => {
    event.preventDefault();
    if (!priceEditorItemId) return;
    const value = Number(priceDraft);
    if (!Number.isFinite(value) || value < 0) {
      showToast('Enter a valid price', { tone: 'error' });
      return;
    }
    updateEntry(priceEditorItemId, entry => ({
      ...entry,
      price: roundCurrency(value),
      priceDecision: 'updated',
      priceControlsExpanded: false
    }));
    setPriceEditorItemId(null);
  };

  const beginCheckout = async () => {
    if (!online) {
      showToast('Reconnect before finishing shopping so Pantry, Spending, and prices can update.', { tone: 'error', durationMs: 5000 });
      return;
    }
    if (!checkedItems.length) {
      showToast('No purchased items yet');
      return;
    }
    if (!(await settleChecks())) {
      showToast('One check-off could not be saved. Review the list and try again.', { tone: 'error' });
      return;
    }

    const checkedStore = currentShoppingStoreId(checkedItems[0]);
    const initialStore = checkedStore || activeStoreId || usualStoreId(items) || '';
    applyTripStore(initialStore || null);
    setCheckoutStoreId(initialStore);
    setAddToPantry(true);
    tripKey.current ||= crypto.randomUUID();
    setCheckoutOpen(true);
    window.setTimeout(() => storeSelectRef.current?.focus(), 0);
  };

  const finishCheckout = async () => {
    if (!checkoutStoreId) {
      showToast('Choose where you are shopping', { tone: 'error' });
      storeSelectRef.current?.focus();
      return;
    }
    if (!(await settleChecks())) {
      showToast('One check-off could not be saved. Review the list and try again.', { tone: 'error' });
      return;
    }

    setCompleting(true);
    try {
      const result = await completeShoppingTrip({
        idempotencyKey: tripKey.current || crypto.randomUUID(),
        purchases: checkedItems.map(item => ({
          listItemId: item._id,
          price: cartEntries[item._id]?.price ?? null,
          storeId: cartEntries[item._id]?.storeId || checkoutStoreId
        })),
        addToPantry
      });
      setCheckoutOpen(false);
      setCartEntries({});
      setActiveStoreId(null);
      tripKey.current = null;
      await onCompleted(result);

      const parts = [`${result.itemCount} item${result.itemCount === 1 ? '' : 's'} finished`];
      if (result.pantryUpdated) parts.push('Pantry updated');
      if (result.missingPriceCount) parts.push(`${result.missingPriceCount} price${result.missingPriceCount === 1 ? '' : 's'} to review later`);
      else parts.push(`${formatCurrency(result.total)} added to Spending`);
      showToast(parts.join(' · '), { tone: 'success', durationMs: 6000 });
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : 'Could not finish shopping', { tone: 'error', durationMs: 5000 });
    } finally {
      setCompleting(false);
    }
  };

  const total = useMemo(() => Object.values(cartEntries).reduce((sum, entry) => sum + (entry.price ?? 0), 0), [cartEntries]);
  const deferredCount = useMemo(() => Object.values(cartEntries).filter(entry => entry.price === null).length, [cartEntries]);
  const activeStoreName = storeName(stores, items, activeStoreId);

  const priceDecisionFor = (item: ShoppingListItem): ReactNode => {
    const entry = cartEntries[item._id];
    if (!entry) return null;
    const hasKnown = entry.suggestedPrice !== null;
    const isLater = entry.priceDecision === 'later';
    return (
      <div className={`purchase-price-choice${isLater ? ' purchase-price-attention' : ''}`}>
        <div className="purchase-price-compact">
          <div className="purchase-price-choice-status">{compactPriceCopy(entry)}</div>
          <button
            type="button"
            className="price-choice-link"
            onClick={() => isLater ? choosePriceDecision(item, 'updated') : togglePriceControls(item._id)}
          >
            {isLater ? 'Add price' : 'Change'}
          </button>
        </div>
        {entry.priceControlsExpanded && (
          <div className="purchase-price-choice-actions" role="group" aria-label={`Price choice for ${entry.name}`}>
            {hasKnown && (
              <button type="button" className={`price-choice-btn${entry.priceDecision === 'existing' ? ' selected' : ''}`} onClick={() => choosePriceDecision(item, 'existing')}>
                Use recent {formatCurrency(entry.suggestedPrice as number)}
              </button>
            )}
            <button type="button" className={`price-choice-btn${entry.priceDecision === 'updated' ? ' selected' : ''}`} onClick={() => choosePriceDecision(item, 'updated')}>Update price</button>
            <button type="button" className={`price-choice-btn${entry.priceDecision === 'later' ? ' selected' : ''}`} onClick={() => choosePriceDecision(item, 'later')}>Later</button>
          </div>
        )}
      </div>
    );
  };

  const confirmedEntries = Object.values(cartEntries).filter(entry => entry.price !== null);
  const deferredEntries = Object.values(cartEntries).filter(entry => entry.price === null);
  const closePriceEditor = () => setPriceEditorItemId(null);
  const closeCheckout = () => {
    if (!completing) setCheckoutOpen(false);
  };

  const dialogs = (
    <>
      {priceEditorItemId && (
        <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closePriceEditor(); }}>
          <div
            className="react-list-modal react-price-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="react-price-title"
            onKeyDown={event => handleDialogKey(event, closePriceEditor)}
          >
            <form onSubmit={saveUpdatedPrice}>
              <div className="react-list-modal-heading">
                <div>
                  <p className="react-list-eyebrow">Purchase price</p>
                  <h2 id="react-price-title">Update price</h2>
                </div>
                <button type="button" className="react-list-modal-close" aria-label="Close Update price" onClick={closePriceEditor}>✕</button>
              </div>
              <label>
                <span>What did you pay?</span>
                <input id="inline-price-value" ref={priceInputRef} type="number" min="0" step="0.01" inputMode="decimal" value={priceDraft} onChange={event => setPriceDraft(event.target.value)} />
              </label>
              <div className="react-list-modal-actions">
                <button type="button" className="shell-button shell-button-secondary" onClick={closePriceEditor}>Cancel</button>
                <button type="submit" className="shell-button shell-button-primary">Use this price</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeCheckout(); }}>
          <div
            className="react-list-modal react-checkout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="react-checkout-title"
            onKeyDown={event => handleDialogKey(event, closeCheckout, completing)}
          >
            <div className="react-list-modal-heading">
              <div>
                <p className="react-list-eyebrow">Shopping stop</p>
                <h2 id="react-checkout-title">Finish shopping</h2>
              </div>
              <button type="button" className="react-list-modal-close" aria-label="Keep shopping" disabled={completing} onClick={closeCheckout}>✕</button>
            </div>

            <div className="finish-shopping-outcomes">
              <strong>Finishing this stop will:</strong>
              <ul>
                <li>Record the prices you confirmed</li>
                <li>Update Spending</li>
                <li>Remove purchased items from this list</li>
                <li>Update Pantry using what you actually got if selected below</li>
              </ul>
              <p>Finish before moving to another store. Store preferences are planning hints; this records where these items were actually purchased.</p>
            </div>

            <label>
              <span>Where are you shopping now?</span>
              <select
                id="parent-trip-store"
                ref={storeSelectRef}
                value={checkoutStoreId}
                disabled={completing}
                onChange={event => {
                  const value = event.target.value;
                  setCheckoutStoreId(value);
                  applyTripStore(value || null);
                }}
              >
                <option value="">Choose a store</option>
                {stores.map(store => <option key={store._id} value={store._id}>{store.name}</option>)}
              </select>
            </label>

            <div id="parent-trip-price-summary">
              <div className="finish-shopping-total">
                <strong>{checkedItems.length} item{checkedItems.length === 1 ? '' : 's'} purchased · {formatCurrency(total)} recorded</strong>
                <span>{deferredCount ? `${deferredCount} price${deferredCount === 1 ? '' : 's'} will be reviewed later.` : 'All prices are recorded.'}</span>
              </div>
              {deferredEntries.length > 0 && (
                <div className="finish-shopping-deferred">
                  <strong>Review later</strong>
                  {deferredEntries.map(entry => <span key={entry.name}>{entry.name}</span>)}
                </div>
              )}
              {confirmedEntries.length > 0 && (
                <details className="finish-shopping-confirmed">
                  <summary>{confirmedEntries.length} recorded price{confirmedEntries.length === 1 ? '' : 's'}</summary>
                  {confirmedEntries.map(entry => (
                    <div key={entry.name}><span>{entry.name} · {entry.quantity} bought</span><span>{formatCurrency(entry.price as number)}</span></div>
                  ))}
                </details>
              )}
            </div>

            <label className="trip-pantry-option">
              <input type="checkbox" checked={addToPantry} disabled={completing} onChange={event => setAddToPantry(event.target.checked)} />
              <span><strong>Update Pantry</strong><small>Actual purchased quantities replenish exact-tracked items.</small></span>
            </label>

            <div className="react-list-modal-actions">
              <button type="button" className="shell-button shell-button-secondary" disabled={completing} onClick={closeCheckout}>Keep shopping</button>
              <button id="parent-finish-shopping" type="button" className="shell-button shell-button-primary" disabled={completing} onClick={() => void finishCheckout()}>
                {completing ? 'Finishing…' : 'Finish shopping'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return {
    cartEntries,
    cartLabel: `${checkedItems.length} bought · ${formatCurrency(total)} recorded${deferredCount ? ` · ${deferredCount} to review` : ''}${activeStoreName ? ` · ${activeStoreName}` : ''}`,
    cartDetail: online ? 'Finish this stop to update Pantry and Spending.' : 'Reconnect to finish this shopping stop.',
    priceDecisionFor,
    beginCheckout,
    dialogs
  };
}
