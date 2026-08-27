// Shopping List tab logic

let listState = { items: [], stores: [], filter: { storeId: null, category: null } };
const cartState = new Map();
const checkSyncState = new Map();
const externalPricesByItemId = new Map();
let activeTripKey = null;
let activeShoppingStoreId = null;
let externalRefreshPromise = null;

function stringId(value) {
  return value === null || value === undefined ? '' : String(value?._id || value);
}

function itemObjectId(item) {
  return stringId(item?.itemId);
}

function plannedStoreId(item) {
  return stringId(item?.storeId || item?.tripStore) || null;
}

function usualStoreId() {
  const context = listState.items.find(item => item.priceContext)?.priceContext;
  return stringId(context?.usualStore) || null;
}

function storeName(storeId) {
  return listState.stores.find(store => stringId(store) === String(storeId || ''))?.name || '';
}

function inferActiveShoppingStore(items = listState.items.filter(item => item.checked)) {
  if (activeShoppingStoreId && listState.stores.some(store => stringId(store) === String(activeShoppingStoreId))) {
    return activeShoppingStoreId;
  }
  const counts = new Map();
  items.forEach(item => {
    const id = plannedStoreId(item);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  });
  activeShoppingStoreId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || usualStoreId() || null;
  return activeShoppingStoreId;
}

async function loadShoppingListTab() {
  try {
    const [items, stores] = await Promise.all([
      api.shoppingList.list(),
      listState.stores.length ? Promise.resolve(listState.stores) : api.stores.list()
    ]);
    listState.items = items.map(item => {
      const pending = checkSyncState.get(item._id);
      return pending ? { ...item, checked: pending.desiredChecked } : item;
    });
    listState.stores = stores;

    if (listState.items.some(item => item.checked)) inferActiveShoppingStore();
    else if (!cartState.size) activeShoppingStoreId = null;

    renderShoppingList();
    loadLowStockBadge();
    void refreshExternalShoppingPrices();
  } catch (err) {
    handleError(err, 'Failed to load shopping list');
  }
}

function renderStoreSummary(items) {
  const container = document.getElementById('list-summary');
  if (!container) return;
  const context = items.find(item => item.priceContext)?.priceContext;
  const savings = Number(context?.estimatedAdditionalStopSavings || 0);
  const threshold = Number(context?.savingsThreshold || 0);
  const additionalName = context?.additionalStore?.name;
  if (!additionalName || savings < threshold) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="store-summary-recommendation parent-trip-suggestion">
      <strong>Worth another stop?</strong>
      ${escapeHtml(additionalName)} saves about <strong>${escapeHtml(formatCurrency(savings))}</strong> across this list.
      <div class="text-muted text-sm">Store suggestions are planning hints. Provista records where you actually shop when you finish each stop.</div>
    </div>`;
}

function knownLinePriceForStore(entry, storeId) {
  if (!entry || !storeId) return null;
  const option = (entry.priceOptions || []).find(price =>
    !price.isStale && stringId(price.store) === String(storeId) &&
    Number.isFinite(Number(price.pricePerUnit)) && Number(price.pricePerUnit) >= 0
  );
  if (!option) return null;
  return Math.round((Number(option.pricePerUnit) * entry.quantity + Number.EPSILON) * 100) / 100;
}

function createCartEntry(item) {
  const quantity = Number(item.quantity) || 1;
  const planningStoreId = plannedStoreId(item);
  const actualStoreId = activeShoppingStoreId || planningStoreId || null;
  const entry = {
    name: item.itemId?.name || 'Unknown item',
    quantity,
    storeId: actualStoreId,
    plannedStoreId: planningStoreId,
    priceOptions: item.priceOptions || [],
    suggestedPrice: null,
    price: null,
    needsPrice: true,
    priceDecision: 'later'
  };
  const known = knownLinePriceForStore(entry, actualStoreId);
  if (known !== null) {
    entry.suggestedPrice = known;
    entry.price = known;
    entry.needsPrice = false;
    entry.priceDecision = 'existing';
  }
  return entry;
}

function ensurePriceDecision(item, entry) {
  if (!entry) return;
  if (!entry.storeId) entry.storeId = activeShoppingStoreId || plannedStoreId(item) || null;
  if (entry.priceDecision === 'updated' || entry.priceDecision === 'later') return;
  const known = knownLinePriceForStore(entry, entry.storeId);
  entry.suggestedPrice = known;
  if (known === null) {
    entry.price = null;
    entry.needsPrice = true;
    entry.priceDecision = 'later';
  } else {
    entry.price = known;
    entry.needsPrice = false;
    entry.priceDecision = 'existing';
  }
}

function decisionCopy(entry) {
  if (entry.priceDecision === 'updated') return `Using updated price ${formatCurrency(entry.price)}`;
  if (entry.priceDecision === 'later') return 'Price will be reviewed later';
  if (entry.suggestedPrice !== null && entry.suggestedPrice !== undefined) {
    return `Using recent price ${formatCurrency(entry.suggestedPrice)}`;
  }
  return 'Price not recorded yet';
}

function priceDecisionMarkup(item, entry) {
  if (!entry) return '';
  ensurePriceDecision(item, entry);
  return `
    <div class="purchase-price-choice">
      <div class="purchase-price-choice-status">${escapeHtml(decisionCopy(entry))}</div>
      <div class="purchase-price-choice-actions" role="group" aria-label="Price choice for ${escapeAttr(entry.name)}">
        ${entry.suggestedPrice !== null && entry.suggestedPrice !== undefined
          ? `<button type="button" class="price-choice-btn ${entry.priceDecision === 'existing' ? 'selected' : ''}" onclick="setPurchasePriceDecision('${escapeAttr(item._id)}', 'existing')">Use ${escapeHtml(formatCurrency(entry.suggestedPrice))}</button>`
          : ''}
        <button type="button" class="price-choice-btn ${entry.priceDecision === 'updated' ? 'selected' : ''}" onclick="setPurchasePriceDecision('${escapeAttr(item._id)}', 'update')">Update price</button>
        <button type="button" class="price-choice-btn ${entry.priceDecision === 'later' ? 'selected' : ''}" onclick="setPurchasePriceDecision('${escapeAttr(item._id)}', 'later')">Later</button>
      </div>
    </div>`;
}

function externalPriceMarkup(item) {
  const signal = externalPricesByItemId.get(itemObjectId(item));
  if (!signal?.observation) return '';
  const observation = signal.observation;
  const age = formatPriceAge(observation.observedAt, true);
  return `<div class="external-price-signal">
    <strong>Open Prices:</strong> ${escapeHtml(formatCurrency(observation.price))} at ${escapeHtml(signal.storeName || 'this store')} · ${escapeHtml(age)}
    <span>Community-observed price - not what your household paid.</span>
  </div>`;
}

function householdPriceMarkup(item, cartEntry) {
  const unit = item.itemId?.unit || '';
  if (cartEntry) {
    return cartEntry.price === null
      ? '<div class="card-subtitle">Bought · price not recorded yet</div>'
      : `<div class="card-subtitle text-success">Bought · ${escapeHtml(formatCurrency(cartEntry.price))} recorded</div>`;
  }
  if (item.tripPrice) {
    const price = Number(item.tripPrice.pricePerUnit);
    return `<div class="card-subtitle">Last paid ${escapeHtml(formatCurrency(price))}${unit ? `/${escapeHtml(unit)}` : ''} at ${escapeHtml(item.tripPrice.store?.name || 'a store')} · ${escapeHtml(formatPriceAge(item.tripPrice.date, true))}</div>`;
  }
  if (item.latestSeenPrice) {
    const latest = item.latestSeenPrice;
    const price = Number(latest.pricePerUnit);
    return `<div class="card-subtitle">Last paid ${escapeHtml(formatCurrency(price))}${unit ? `/${escapeHtml(unit)}` : ''} at ${escapeHtml(latest.store?.name || 'a store')} · Price may have changed</div>`;
  }
  return '<div class="card-subtitle">No recent household price</div>';
}

function renderShoppingList() {
  const items = listState.items;
  const filter = listState.filter;
  const visibleItems = items.filter(item => {
    if (filter.storeId && stringId(item.storeId) !== filter.storeId) return false;
    if (filter.category && item.itemId?.category !== filter.category) return false;
    return true;
  });
  const hiddenCount = items.length - visibleItems.length;

  renderStoreSummary(items);
  updateListFilterDot();

  const currentIds = new Set(items.map(item => item._id));
  [...cartState.keys()].forEach(id => {
    if (!currentIds.has(id)) cartState.delete(id);
  });
  const checkedItems = items.filter(item => item.checked);
  if (checkedItems.length && !activeShoppingStoreId) inferActiveShoppingStore(checkedItems);
  checkedItems.forEach(item => {
    if (!cartState.has(item._id)) cartState.set(item._id, createCartEntry(item));
  });
  items.filter(item => !item.checked).forEach(item => cartState.delete(item._id));
  if (!cartState.size) activeShoppingStoreId = null;
  updateCartBar();

  const container = document.getElementById('shopping-list');
  const hasItems = items.length > 0;
  const hasChecked = checkedItems.length > 0;
  const clearAllBtn = document.getElementById('btn-clear-all');
  const deselectAllBtn = document.getElementById('btn-deselect-all');
  if (clearAllBtn) clearAllBtn.style.display = hasItems ? '' : 'none';
  if (deselectAllBtn) deselectAllBtn.style.display = hasChecked ? '' : 'none';

  if (!items.length) {
    container.innerHTML = emptyState('📋', 'Your list is empty. Type groceries above, or use Add with details for a new product.');
    return;
  }

  const filterBar = hiddenCount > 0
    ? `<div class="list-filter-bar">${hiddenCount} item${hiddenCount !== 1 ? 's' : ''} hidden by filter - <button onclick="clearListFilter()">Clear filter</button></div>`
    : '';

  if (!visibleItems.length) {
    container.innerHTML = filterBar + emptyState('🔍', 'No items match the current filter.');
    return;
  }

  const itemMarkup = item => {
    const name = item.itemId?.name || 'Unknown item';
    const cartEntry = cartState.get(item._id);
    const explicitStore = item.storeId?.name || null;
    const metadata = item.itemId ? formatItemMeta(item.itemId) : escapeHtml(item.itemId?.category || '');
    return `
      <div class="card list-item ${item.checked ? 'checked' : ''}" data-id="${escapeAttr(item._id)}">
        <button type="button" class="list-item-check-wrap" onclick="handleListItemCheck('${escapeAttr(item._id)}', ${!item.checked})"
          aria-label="${item.checked ? 'Uncheck' : 'Mark as purchased'} ${escapeAttr(name)}" aria-pressed="${item.checked}">
          <span class="list-item-check ${item.checked ? 'checked' : ''}" aria-hidden="true">${item.checked ? '✓' : ''}</span>
        </button>
        <div class="card-body">
          <div class="card-title">${escapeHtml(name)}</div>
          <div class="list-item-meta">${metadata}${metadata ? ' · ' : ''}qty ${escapeHtml(item.quantity)}</div>
          <button class="list-item-store-btn" onclick="openStorePickerForItem('${escapeAttr(item._id)}')">${explicitStore ? `Preferred: ${escapeHtml(explicitStore)}` : 'Set store preference'}</button>
          ${householdPriceMarkup(item, cartEntry)}
          ${item.checked ? priceDecisionMarkup(item, cartEntry) : externalPriceMarkup(item)}
        </div>
        <button class="btn btn-icon text-danger list-item-remove" onclick="removeListItem('${escapeAttr(item._id)}')"
          aria-label="Remove ${escapeAttr(name)} from the list">✕</button>
      </div>`;
  };

  const groups = new Map();
  visibleItems.forEach(item => {
    const suggestedName = item.tripStore?.name || item.storeId?.name || 'Any store';
    if (!groups.has(suggestedName)) groups.set(suggestedName, []);
    groups.get(suggestedName).push(item);
  });
  const groupedMarkup = [...groups.entries()].map(([suggestedName, groupItems]) => `
    <section class="list-store-group" aria-label="Suggested stop ${escapeAttr(suggestedName)}">
      <div class="list-store-heading">
        <h2>${suggestedName === 'Any store' ? 'No store preference' : `Suggested: ${escapeHtml(suggestedName)}`}</h2>
        <span>${groupItems.length} item${groupItems.length === 1 ? '' : 's'}</span>
      </div>
      ${groupItems.map(itemMarkup).join('')}
    </section>`).join('');
  container.innerHTML = filterBar + groupedMarkup;
}

async function refreshExternalShoppingPrices() {
  if (externalRefreshPromise || !navigator.onLine) return externalRefreshPromise;
  externalRefreshPromise = api.externalPrices.refreshShoppingList()
    .then(result => {
      externalPricesByItemId.clear();
      (result.observations || []).forEach(signal => externalPricesByItemId.set(String(signal.itemId), signal));
      if (document.getElementById('tab-list')?.classList.contains('active')) renderShoppingList();
    })
    .catch(err => console.info('External price refresh unavailable:', err.message))
    .finally(() => { externalRefreshPromise = null; });
  return externalRefreshPromise;
}

function setPurchasePriceDecision(itemId, decision) {
  const item = listState.items.find(candidate => candidate._id === itemId);
  const entry = cartState.get(itemId);
  if (!item || !entry) return;

  if (decision === 'existing') {
    const known = knownLinePriceForStore(entry, entry.storeId);
    if (known === null) return showToast('No recent household price is available for this store.');
    entry.suggestedPrice = known;
    entry.price = known;
    entry.needsPrice = false;
    entry.priceDecision = 'existing';
    renderShoppingList();
    return;
  }
  if (decision === 'later') {
    entry.price = null;
    entry.needsPrice = true;
    entry.priceDecision = 'later';
    renderShoppingList();
    return;
  }
  if (decision === 'update') openInlinePriceEditor(item, entry);
}

function openInlinePriceEditor(item, entry) {
  const name = item.itemId?.name || entry.name || 'Item';
  const current = entry.price ?? entry.suggestedPrice;
  openModal('Update price', `
    <form id="inline-price-form">
      <p class="text-muted text-sm">Enter what you paid for <strong>${escapeHtml(name)}</strong>. Saving returns you to the list.</p>
      <div class="form-group">
        <label for="inline-price-value">Price paid</label>
        <input class="form-control" id="inline-price-value" type="number" inputmode="decimal" min="0" step="0.01" required
          value="${current === null || current === undefined ? '' : escapeAttr(Number(current).toFixed(2))}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Use this price</button>
      </div>
    </form>`);
  const input = document.getElementById('inline-price-value');
  setTimeout(() => input?.select(), 0);
  document.getElementById('inline-price-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) return showToast('Enter a valid price');
    entry.price = Math.round((value + Number.EPSILON) * 100) / 100;
    entry.needsPrice = false;
    entry.priceDecision = 'updated';
    closeModal();
    renderShoppingList();
  });
}

function handleListItemCheck(id, willBeChecked) {
  const item = listState.items.find(entry => entry._id === id);
  if (!item) return;
  let sync = checkSyncState.get(id);
  if (!sync) {
    sync = { serverChecked: Boolean(item.checked), desiredChecked: Boolean(item.checked), processing: false, promise: null };
    checkSyncState.set(id, sync);
  }
  sync.desiredChecked = Boolean(willBeChecked);
  item.checked = sync.desiredChecked;

  if (item.checked) {
    if (!activeShoppingStoreId) activeShoppingStoreId = plannedStoreId(item) || usualStoreId() || null;
    cartState.set(id, createCartEntry(item));
  } else {
    cartState.delete(id);
    if (!cartState.size) activeShoppingStoreId = null;
  }

  renderShoppingList();
  document.querySelector(`.list-item[data-id="${CSS.escape(id)}"] .list-item-check-wrap`)?.focus({ preventScroll: true });
  if (!sync.processing) sync.promise = persistListItemCheck(id);
}

async function persistListItemCheck(id) {
  const sync = checkSyncState.get(id);
  if (!sync || sync.processing) return true;
  sync.processing = true;
  try {
    while (sync.serverChecked !== sync.desiredChecked) {
      const target = sync.desiredChecked;
      await api.shoppingList.update(id, { checked: target });
      sync.serverChecked = target;
    }
    checkSyncState.delete(id);
    return true;
  } catch (err) {
    const item = listState.items.find(entry => entry._id === id);
    if (item) {
      item.checked = sync.serverChecked;
      if (item.checked) cartState.set(id, createCartEntry(item));
      else cartState.delete(id);
      if (!cartState.size) activeShoppingStoreId = null;
      renderShoppingList();
    }
    checkSyncState.delete(id);
    console.error(err);
    showToast('Could not save that item. Your check-off was rolled back.', 4000);
    return false;
  } finally {
    sync.processing = false;
  }
}

async function settlePendingCheckWrites() {
  const pending = [...checkSyncState.values()].map(sync => sync.promise).filter(Boolean);
  if (!pending.length) return true;
  const results = await Promise.all(pending);
  return results.every(result => result !== false);
}

function updateCartBar() {
  const bar = document.getElementById('cart-bar');
  const label = document.getElementById('cart-bar-label');
  const tab = document.getElementById('tab-list');
  if (!bar) return;

  if (!cartState.size) {
    activeTripKey = null;
    activeShoppingStoreId = null;
    bar.style.display = 'none';
    tab?.classList.remove('has-cart');
    const detail = document.getElementById('cart-bar-detail');
    if (detail) detail.style.display = 'none';
    document.getElementById('cart-bar-summary')?.setAttribute('aria-expanded', 'false');
    document.getElementById('cart-more-menu')?.removeAttribute('open');
    return;
  }

  let total = 0;
  let later = 0;
  cartState.forEach(entry => {
    if (entry.price !== null && Number.isFinite(Number(entry.price))) total += Number(entry.price);
    else later++;
  });
  const stop = storeName(activeShoppingStoreId);
  bar.style.display = '';
  tab?.classList.add('has-cart');
  if (label) label.textContent = `${cartState.size} bought · ${formatCurrency(total)} recorded${later ? ` · ${later} to review` : ''}${stop ? ` · ${stop}` : ''}`;

  const doneButton = document.getElementById('btn-done-shopping');
  if (doneButton) {
    doneButton.disabled = false;
    doneButton.setAttribute('aria-label', `Finish shopping with ${cartState.size} item${cartState.size === 1 ? '' : 's'}`);
  }

  const detail = document.getElementById('cart-bar-detail');
  if (detail && detail.style.display !== 'none') renderCartDetail(detail);
}

function renderCartDetail(container) {
  let total = 0;
  const rows = [];
  cartState.forEach(entry => {
    if (entry.price !== null && Number.isFinite(Number(entry.price))) total += Number(entry.price);
    rows.push(`<div class="cart-detail-row"><span>${escapeHtml(entry.name)}</span><span>${entry.price === null ? 'Review later' : escapeHtml(formatCurrency(entry.price))}</span></div>`);
  });
  rows.push(`<div class="cart-detail-row cart-detail-total"><span>Recorded so far</span><span>${escapeHtml(formatCurrency(total))}</span></div>`);
  container.innerHTML = rows.join('');
}

function applyTripStore(storeId) {
  activeShoppingStoreId = storeId || null;
  cartState.forEach(entry => {
    entry.storeId = activeShoppingStoreId;
    if (entry.priceDecision !== 'existing') return;
    const known = knownLinePriceForStore(entry, activeShoppingStoreId);
    entry.suggestedPrice = known;
    if (known === null) {
      entry.price = null;
      entry.needsPrice = true;
      entry.priceDecision = 'later';
    } else {
      entry.price = known;
      entry.needsPrice = false;
    }
  });
}

function renderFinishShoppingSummary() {
  const container = document.getElementById('parent-trip-price-summary');
  if (!container) return;
  let total = 0;
  const confirmed = [];
  const deferred = [];
  cartState.forEach(entry => {
    if (entry.price === null || !Number.isFinite(Number(entry.price))) deferred.push(entry);
    else {
      total += Number(entry.price);
      confirmed.push(entry);
    }
  });
  container.innerHTML = `
    <div class="finish-shopping-total"><strong>${cartState.size} item${cartState.size === 1 ? '' : 's'} purchased · ${escapeHtml(formatCurrency(total))} recorded</strong>
      ${deferred.length ? `<span>${deferred.length} price${deferred.length === 1 ? '' : 's'} will be reviewed later.</span>` : '<span>All prices are recorded.</span>'}
    </div>
    ${deferred.length ? `<div class="finish-shopping-deferred"><strong>Review later</strong>${deferred.map(entry => `<span>${escapeHtml(entry.name)}</span>`).join('')}</div>` : ''}
    ${confirmed.length ? `<details class="finish-shopping-confirmed"><summary>${confirmed.length} recorded price${confirmed.length === 1 ? '' : 's'}</summary>${confirmed.map(entry => `<div><span>${escapeHtml(entry.name)}</span><span>${escapeHtml(formatCurrency(entry.price))}</span></div>`).join('')}</details>` : ''}`;
}

function openDoneShoppingReview() {
  const checkedItems = listState.items.filter(item => item.checked);
  if (!checkedItems.length) return showToast('No purchased items yet');
  inferActiveShoppingStore(checkedItems);
  checkedItems.forEach(item => {
    if (!cartState.has(item._id)) cartState.set(item._id, createCartEntry(item));
    ensurePriceDecision(item, cartState.get(item._id));
  });

  activeTripKey ||= typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const initialStoreId = activeShoppingStoreId || usualStoreId() || '';
  applyTripStore(initialStoreId);
  const storeOptions = listState.stores.map(store =>
    `<option value="${escapeAttr(store._id)}">${escapeHtml(store.name)}</option>`
  ).join('');

  openModal('Finish shopping', `
    <div class="finish-shopping-outcomes">
      <strong>Finishing this stop will:</strong>
      <ul>
        <li>Add purchased items to Pantry</li>
        <li>Record the prices you confirmed</li>
        <li>Update Spending</li>
        <li>Remove purchased items from this list</li>
      </ul>
      <p class="text-muted text-sm">Finish before moving to another store. Store preferences on the list are planning hints; this records where these items were actually purchased.</p>
    </div>
    <div class="form-group">
      <label for="parent-trip-store">Where are you shopping now?</label>
      <select class="form-control" id="parent-trip-store">
        <option value="">Choose a store</option>
        ${storeOptions}
      </select>
    </div>
    <div id="parent-trip-price-summary"></div>
    <label class="trip-pantry-option">
      <input type="checkbox" id="parent-trip-add-to-pantry" checked />
      <span><strong>Update Pantry</strong><small>Purchased items become Have; exact-tracked quantities are replenished.</small></span>
    </label>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Keep shopping</button>
      <button type="button" class="btn btn-primary" id="parent-finish-shopping">Finish shopping</button>
    </div>`);

  const storeSelect = document.getElementById('parent-trip-store');
  if (storeSelect && initialStoreId) storeSelect.value = String(initialStoreId);
  renderFinishShoppingSummary();
  storeSelect?.addEventListener('change', event => {
    applyTripStore(event.target.value || null);
    renderFinishShoppingSummary();
    updateCartBar();
  });
  document.getElementById('parent-finish-shopping')?.addEventListener('click', finishParentShoppingTrip);
}

async function finishParentShoppingTrip() {
  const button = document.getElementById('parent-finish-shopping');
  const storeId = document.getElementById('parent-trip-store')?.value || null;
  if (!storeId) {
    showToast('Choose where you are shopping');
    document.getElementById('parent-trip-store')?.focus();
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Finishing…'; }

  if (!(await settlePendingCheckWrites())) {
    if (button) { button.disabled = false; button.textContent = 'Finish shopping'; }
    return showToast('One check-off could not be saved. Review the list and try again.');
  }

  const checkedItems = listState.items.filter(item => item.checked);
  const purchases = checkedItems.map(item => {
    const entry = cartState.get(item._id);
    const rawPrice = entry?.price;
    const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
    return {
      listItemId: item._id,
      price: Number.isFinite(price) && price >= 0 ? price : null,
      storeId
    };
  });

  try {
    const result = await api.shoppingList.complete({
      idempotencyKey: activeTripKey,
      purchases,
      addToPantry: document.getElementById('parent-trip-add-to-pantry')?.checked !== false
    });
    checkedItems.forEach(item => cartState.delete(item._id));
    activeTripKey = null;
    activeShoppingStoreId = null;
    closeModal();
    await loadShoppingListTab();
    if (typeof loadDeferredPrices === 'function') void loadDeferredPrices();

    const parts = [`${result.itemCount} item${result.itemCount === 1 ? '' : 's'} finished`];
    if (result.pantryUpdated) parts.push('Pantry updated');
    if (result.missingPriceCount) parts.push(`${result.missingPriceCount} price${result.missingPriceCount === 1 ? '' : 's'} to review later`);
    else parts.push(`${formatCurrency(result.total)} added to Spending`);
    showToast(parts.join(' · '), 6000);
  } catch (err) {
    handleError(err, 'Could not finish shopping');
    if (button) { button.disabled = false; button.textContent = 'Finish shopping'; }
  }
}

async function removeListItem(id) {
  const item = listState.items.find(entry => entry._id === id);
  const name = item?.itemId?.name || 'This item';
  const confirmed = await confirmAction({
    title: 'Remove from list?',
    message: `${name} will be removed from this shopping list. Pantry and price history will not change.`,
    confirmLabel: 'Remove from list'
  });
  if (!confirmed) return;
  try {
    await api.shoppingList.delete(id);
    cartState.delete(id);
    listState.items = listState.items.filter(entry => entry._id !== id);
    if (!cartState.size) activeShoppingStoreId = null;
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to remove item');
  }
}

function openAddListItemModal(initialName = '', options = {}) {
  const storeOptions = listState.stores.map(store => `<option value="${escapeAttr(store._id)}">${escapeHtml(store.name)}</option>`).join('');
  const bodyHTML = `
    <form id="add-list-form">
      <div class="form-group">
        <label for="list-item-input">What do you need?</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="list-item-input" placeholder="Search or create item…" autocomplete="off" required />
          <div class="autocomplete-dropdown" id="list-item-dropdown"></div>
        </div>
        <input type="hidden" id="list-item-id" />
      </div>
      ${inlineItemCreationFields('list')}
      <div class="form-group">
        <label for="list-qty">Quantity</label>
        <input class="form-control" type="number" id="list-qty" value="1" min="1" step="1" required />
      </div>
      ${storeOptions ? `
        <div class="form-group">
          <label for="list-store-select">Store preference <span class="text-muted text-sm">(optional planning hint)</span></label>
          <select class="form-control" id="list-store-select">
            <option value="">Any store</option>
            ${storeOptions}
          </select>
          <p class="text-muted text-sm">You’ll record where you actually bought it when you finish shopping.</p>
        </div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to list</button>
      </div>
    </form>`;

  openModal('Add with details', bodyHTML);
  const itemInput = document.getElementById('list-item-input');
  const itemDropdown = document.getElementById('list-item-dropdown');
  let selectedItemName = '';
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) {
      selectedItemName = item.name;
      document.getElementById('list-item-id').value = item._id;
      clearInlineItemCreation('list');
    },
    onCreateNew: name => {
      selectedItemName = '';
      startInlineItemCreation('list', name, 'list-item-input', 'list-item-id');
    }
  });
  itemInput.addEventListener('input', () => {
    if (document.getElementById('list-new-item-mode')?.value === 'true') return;
    if (selectedItemName && itemInput.value !== selectedItemName) document.getElementById('list-item-id').value = '';
  });

  if (initialName) {
    itemInput.value = initialName;
    itemInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.getElementById('add-list-form').addEventListener('submit', async event => {
    event.preventDefault();
    let itemId = document.getElementById('list-item-id').value;
    const qty = parseInt(document.getElementById('list-qty').value, 10);
    const storeId = document.getElementById('list-store-select')?.value || null;
    const submit = formSubmitButton(event.target);
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      if (!itemId) {
        const newItem = readInlineItemCreation('list', itemInput.value);
        if (!newItem) throw new Error('Select an item or choose Create');
        const created = await api.items.create(newItem);
        itemId = created._id;
      }
      await api.shoppingList.add({ itemId, quantity: qty, ...(storeId ? { storeId } : {}) });
      const addedName = itemInput.value.trim();
      closeModal();
      showToast(`${addedName || 'Item'} added to list`);
      await loadShoppingListTab();
      options.onAdded?.({ itemId, name: addedName, quantity: qty });
    } catch (err) {
      handleError(err, 'Failed to add item');
      submit.disabled = false;
      submit.textContent = 'Add to list';
    }
  });
}

function openStorePickerForItem(id) {
  const item = listState.items.find(entry => entry._id === id);
  if (!item) return;
  const currentStoreId = stringId(item.storeId);
  const options = listState.stores.map(store =>
    `<option value="${escapeAttr(store._id)}"${stringId(store) === currentStoreId ? ' selected' : ''}>${escapeHtml(store.name)}</option>`
  ).join('');

  openModal('Store preference', `
    <form id="store-picker-form">
      <p class="text-muted text-sm">This is a planning hint. Finish shopping records the store where you actually bought the item.</p>
      <div class="form-group">
        <label for="store-picker-select">Prefer to buy this at</label>
        <select class="form-control" id="store-picker-select">
          <option value="">Any store</option>
          ${options}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save preference</button>
      </div>
    </form>`);

  document.getElementById('store-picker-form').addEventListener('submit', async event => {
    event.preventDefault();
    const storeId = document.getElementById('store-picker-select').value || null;
    try {
      await api.shoppingList.update(id, { storeId });
      item.storeId = storeId ? listState.stores.find(store => stringId(store) === storeId) : null;
      closeModal();
      renderShoppingList();
    } catch (err) {
      handleError(err, 'Failed to update store preference');
    }
  });
}

function updateListFilterDot() {
  const active = listState.filter.storeId || listState.filter.category;
  const dot = document.getElementById('list-filter-dot');
  if (dot) dot.style.display = active ? '' : 'none';
}

function clearListFilter() {
  listState.filter = { storeId: null, category: null };
  renderShoppingList();
}

function openListFilterSheet() {
  const f = listState.filter;
  const stores = listState.stores;
  const categories = [...new Set(listState.items.map(item => item.itemId?.category).filter(Boolean))].sort();
  const storeChips = stores.map(store =>
    `<button class="filter-chip${f.storeId === stringId(store) ? ' selected' : ''}" data-store-id="${escapeAttr(store._id)}" onclick="toggleListFilterStore(this)">${escapeHtml(store.name)}</button>`
  ).join('');
  const catChips = categories.map(category =>
    `<button class="filter-chip${f.category === category ? ' selected' : ''}" data-cat="${escapeAttr(category)}" onclick="toggleListFilterCat(this)">${escapeHtml(category)}</button>`
  ).join('');

  document.getElementById('filter-sheet-title').textContent = 'Filter List';
  document.getElementById('filter-sheet-body').innerHTML = `
    ${stores.length ? `<div><div class="filter-section-label">Store preference</div><div class="filter-chips">${storeChips}</div></div>` : ''}
    ${categories.length ? `<div><div class="filter-section-label">Category</div><div class="filter-chips">${catChips}</div></div>` : ''}
    ${!stores.length && !categories.length ? '<p class="text-muted text-sm">No stores or categories to filter by.</p>' : ''}`;

  document.getElementById('filter-sheet-clear').onclick = () => {
    listState.filter = { storeId: null, category: null };
    closeListFilterSheet();
    renderShoppingList();
  };
  document.getElementById('filter-sheet-done').onclick = () => {
    closeListFilterSheet();
    renderShoppingList();
  };
  const overlay = document.getElementById('filter-sheet-overlay');
  const closeAndApply = () => { closeListFilterSheet(); renderShoppingList(); };
  activateDialogSurface(overlay, document.getElementById('filter-sheet'), document.getElementById('filter-sheet-done'), closeAndApply);
  overlay.onclick = event => {
    if (event.target === overlay) closeAndApply();
  };
}

function closeListFilterSheet() {
  deactivateDialogSurface(document.getElementById('filter-sheet-overlay'), document.getElementById('filter-sheet'));
}

function toggleListFilterStore(button) {
  const id = button.dataset.storeId;
  const wasSelected = button.classList.contains('selected');
  button.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(candidate => candidate.classList.remove('selected'));
  listState.filter.storeId = wasSelected ? null : id;
  if (!wasSelected) button.classList.add('selected');
}

function toggleListFilterCat(button) {
  const category = button.dataset.cat;
  const wasSelected = button.classList.contains('selected');
  button.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(candidate => candidate.classList.remove('selected'));
  listState.filter.category = wasSelected ? null : category;
  if (!wasSelected) button.classList.add('selected');
}

async function deselectAll() {
  const checked = listState.items.filter(item => item.checked);
  if (!checked.length) return showToast('No purchased items to uncheck');
  checked.forEach(item => handleListItemCheck(item._id, false));
  if (await settlePendingCheckWrites()) showToast('Purchased items unchecked');
}

async function removeCheckedWithoutRecording(event) {
  const count = listState.items.filter(item => item.checked).length;
  if (!count) return showToast('No purchased items');
  const confirmed = await confirmAction({
    title: 'Remove without recording?',
    message: `${count} purchased item${count === 1 ? '' : 's'} will leave the list without updating Pantry, Spending, or price history.`,
    confirmLabel: 'Remove without recording'
  });
  if (!confirmed) return;
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    if (!(await settlePendingCheckWrites())) return showToast('A check-off could not be saved. Review the list and try again.');
    listState.items.filter(item => item.checked).forEach(item => cartState.delete(item._id));
    await api.shoppingList.clear(true);
    activeShoppingStoreId = null;
    await loadShoppingListTab();
    showToast('Purchased items removed without recording');
  } catch (err) {
    handleError(err, 'Failed to remove purchased items');
  } finally {
    if (button) button.disabled = false;
  }
}

async function emptyShoppingList(event) {
  if (!listState.items.length) return showToast('List is already empty');
  const confirmed = await confirmAction({
    title: 'Empty the shopping list?',
    message: 'Every item will be removed from this list. Pantry, Spending, and price history will not change.',
    confirmLabel: 'Empty list'
  });
  if (!confirmed) return;
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    await settlePendingCheckWrites();
    cartState.clear();
    activeShoppingStoreId = null;
    await api.shoppingList.clear(false);
    await loadShoppingListTab();
    showToast('Shopping list emptied');
  } catch (err) {
    handleError(err, 'Failed to empty list');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadLowStockBadge() {
  const button = document.getElementById('btn-low-stock');
  const countElement = document.getElementById('low-stock-count');
  if (!button) return;
  try {
    const items = await api.request('GET', '/inventory/low-stock');
    if (items.length) {
      button.style.display = '';
      if (countElement) countElement.textContent = items.length;
    } else {
      button.style.display = 'none';
    }
    button._lowStockItems = items;
  } catch (_) {
    button.style.display = 'none';
  }
}

function lowStockDetail(inv) {
  const status = inv.stockStatus === 'out' ? 'Out' : 'Running low';
  if (inv.trackingMode !== 'exact') return status;
  const unit = inv.unit || inv.itemId?.unit || '';
  const quantity = Number(inv.quantity) || 0;
  const threshold = inv.lowStockThreshold;
  if (threshold === null || threshold === undefined) return `${quantity}${unit ? ` ${unit}` : ''} left`;
  return `${quantity}${unit ? ` ${unit}` : ''} left · low at ${threshold}${unit ? ` ${unit}` : ''}`;
}

function openLowStockReview() {
  const items = document.getElementById('btn-low-stock')?._lowStockItems || [];
  if (!items.length) return showToast('No low-stock items');
  const onListIds = new Set(listState.items.map(item => stringId(item.itemId)));

  const bodyHTML = `
    <p class="text-muted text-sm" style="margin-bottom:0.75rem">Choose low or out items to add. Items already on the List stay there.</p>
    <div id="low-stock-list">
      ${items.map(inv => {
        const itemId = stringId(inv.itemId);
        const name = inv.itemId?.name || 'Unknown';
        const alreadyOn = onListIds.has(itemId);
        return `
          <div class="card" style="margin-bottom:0.5rem">
            <div class="card-body">
              <div class="card-title">${escapeHtml(name)}</div>
              <div class="card-subtitle">${escapeHtml(lowStockDetail(inv))}</div>
            </div>
            ${alreadyOn
              ? '<span class="low-stock-on-list">On list ✓</span>'
              : `<label class="low-stock-choice"><input type="checkbox" class="low-stock-check" data-id="${escapeAttr(itemId)}" aria-label="Add ${escapeAttr(name)} to the shopping list" /></label>`}
          </div>`;
      }).join('')}
    </div>
    <div class="form-actions" style="margin-top:0.75rem">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button type="button" class="btn btn-primary" id="btn-add-low-stock">Add selected to list</button>
    </div>`;

  openModal('Add low-stock items', bodyHTML);
  document.getElementById('btn-add-low-stock').addEventListener('click', async () => {
    const toAdd = [...document.querySelectorAll('.low-stock-check:checked')].map(input => input.dataset.id);
    if (!toAdd.length) { closeModal(); return; }
    try {
      await Promise.all(toAdd.map(itemId => api.shoppingList.add({ itemId, quantity: 1 })));
      closeModal();
      showToast(`Added ${toAdd.length} item${toAdd.length === 1 ? '' : 's'} to list`);
      await loadShoppingListTab();
    } catch (err) {
      handleError(err, 'Failed to add items');
    }
  });
}

function initShoppingListTab() {
  const clearAll = document.getElementById('btn-clear-all');
  if (clearAll) clearAll.style.display = 'none';

  document.getElementById('btn-add-list-item')?.addEventListener('click', () => openAddListItemModal());
  document.getElementById('btn-list-filter')?.addEventListener('click', openListFilterSheet);

  const scanListBtn = document.getElementById('btn-scan-list-item');
  if (scanListBtn) {
    if (!window.appAuth?.features?.barcodeScanning) {
      scanListBtn.style.display = 'none';
    } else {
      scanListBtn.addEventListener('click', () => {
        if (!window.BarcodeScanner) return showToast('Scanner unavailable. Try reloading the page.', 3000);
        BarcodeScanner.open(async upc => {
          if (!upc) return;
          await handleBarcodeResult(upc, async item => {
            try {
              await api.shoppingList.add({ itemId: item._id, quantity: 1 });
              await loadShoppingListTab();
              showToast(`${item.name} added to list`);
            } catch (err) {
              handleError(err, 'Failed to add item to list');
            }
          });
        });
      });
    }
  }

  document.getElementById('btn-deselect-all')?.addEventListener('click', deselectAll);
  document.getElementById('btn-remove-checked')?.addEventListener('click', removeCheckedWithoutRecording);
  document.getElementById('btn-done-shopping')?.addEventListener('click', openDoneShoppingReview);
  document.getElementById('btn-low-stock')?.addEventListener('click', openLowStockReview);
  clearAll?.addEventListener('click', emptyShoppingList);

  document.getElementById('cart-bar-summary')?.addEventListener('click', () => {
    const detail = document.getElementById('cart-bar-detail');
    const summary = document.getElementById('cart-bar-summary');
    if (!detail) return;
    const open = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : '';
    summary?.setAttribute('aria-expanded', String(!open));
    document.querySelector('.cart-bar-chevron')?.classList.toggle('expanded', !open);
    if (!open) renderCartDetail(detail);
  });
}
