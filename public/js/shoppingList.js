// Shopping List tab logic

let listState = { items: [], stores: [], filter: { storeId: null, category: null } };

// Cart state: inferred prices while shopping. Missing-price exceptions are reviewed at the end.
const cartState = new Map();
let activeTripKey = null;

// Per-item persistence queues let the UI respond immediately while preserving
// the user's latest intent if they check and then undo before the first request returns.
const checkSyncState = new Map();

// =============================================================
// Loading & Rendering
// =============================================================

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
    renderShoppingList();
    loadLowStockBadge();
  } catch (err) {
    handleError(err, 'Failed to load shopping list');
  }
}

function renderShoppingList() {
  const items = listState.items;
  const filter = listState.filter;

  const visibleItems = items.filter(item => {
    if (filter.storeId && (item.storeId?._id || item.storeId) !== filter.storeId) return false;
    if (filter.category && item.itemId?.category !== filter.category) return false;
    return true;
  });
  const hiddenCount = items.length - visibleItems.length;

  renderStoreSummary(items);
  updateListFilterDot();

  // Keep cart state recoverable after reloads and in sync with server check-off state.
  const currentIds = new Set(items.map(item => item._id));
  [...cartState.keys()].forEach(id => {
    if (!currentIds.has(id)) cartState.delete(id);
  });
  items.forEach(item => {
    if (item.checked && !cartState.has(item._id)) cartState.set(item._id, createCartEntry(item));
    if (!item.checked) cartState.delete(item._id);
  });
  updateCartBar();

  const container = document.getElementById('shopping-list');

  // Show/hide list-wide actions based on total state (not filtered view).
  const hasItems = items.length > 0;
  const hasChecked = items.some(i => i.checked);
  const clearAllBtn = document.getElementById('btn-clear-all');
  const deselectAllBtn = document.getElementById('btn-deselect-all');
  if (clearAllBtn) clearAllBtn.style.display = hasItems ? '' : 'none';
  if (deselectAllBtn) deselectAllBtn.style.display = hasChecked ? '' : 'none';

  if (!items.length) {
    container.innerHTML = emptyState('📋', 'Your shopping list is empty. Tap "+ Add" to start.');
    return;
  }

  const filterBar = hiddenCount > 0
    ? `<div class="list-filter-bar">${hiddenCount} item${hiddenCount !== 1 ? 's' : ''} hidden by filter &mdash; <button onclick="clearListFilter()">Clear filter</button></div>`
    : '';

  if (!visibleItems.length) {
    container.innerHTML = filterBar + emptyState('🔍', 'No items match the current filter.');
    return;
  }

  const itemMarkup = item => {
    const name = item.itemId?.name || 'Unknown item';
    const unit = item.itemId?.unit || '';
    const cat = item.itemId?.category || '';
    const checked = item.checked;
    const cartEntry = cartState.get(item._id);
    const assignedStore = item.storeId?.name || null;

    let priceInfo = '';
    if (cartEntry) {
      priceInfo = cartEntry.needsPrice
        ? '<div class="card-subtitle" style="color:var(--warning)">In cart · price needed</div>'
        : `<div class="card-subtitle text-success">In cart: ${formatCurrency(cartEntry.price)}</div>`;
    } else if (item.tripPrice) {
      const { store, pricePerUnit, date } = item.tripPrice;
      priceInfo = `<div class="card-subtitle price-freshness">
        ${escapeHtml(store?.name || 'Store')} · ${escapeHtml(formatPPU(pricePerUnit, unit))} · ${escapeHtml(formatPriceAge(date))}
      </div>`;
    } else if (item.latestSeenPrice) {
      const latest = item.latestSeenPrice;
      priceInfo = `<div class="card-subtitle price-stale">
        Last seen at ${escapeHtml(latest.store?.name || 'a store')} · ${escapeHtml(formatPriceAge(latest.date, true))}
        ${latest.isStale ? '<span class="badge badge-stale">Stale</span>' : ''}
      </div>`;
    } else {
      priceInfo = `<span class="badge badge-no-data">No price data</span>`;
    }

    const storeLine = `<button class="list-item-store-btn" onclick="openStorePickerForItem('${item._id}')">${assignedStore ? '🏪 ' + escapeHtml(assignedStore) : '+ Store'}</button>`;

    return `
      <div class="card list-item ${checked ? 'checked' : ''}" data-id="${item._id}">
        <button type="button" class="list-item-check-wrap" onclick="handleListItemCheck('${item._id}', ${!checked})"
          aria-label="${checked ? 'Uncheck' : 'Mark as purchased'} ${escapeAttr(name)}" aria-pressed="${checked}">
          <span class="list-item-check ${checked ? 'checked' : ''}" aria-hidden="true">${checked ? '✓' : ''}</span>
        </button>
        <div class="card-body">
          <div class="card-title">${escapeHtml(name)}${item.itemId?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(item.itemId.brand) + ')</span>' : ''}</div>
          <div class="list-item-meta">${item.itemId ? formatItemMeta(item.itemId) : cat} &middot; qty ${item.quantity}</div>
          ${storeLine}
          ${priceInfo}
        </div>
        <button class="btn btn-icon text-danger list-item-remove" onclick="removeListItem('${item._id}')"
          aria-label="Remove ${escapeAttr(name)} from the list">✕</button>
      </div>`;
  };

  const groups = new Map();
  visibleItems.forEach(item => {
    const storeName = item.tripStore?.name || item.storeId?.name || 'Choose store at checkout';
    if (!groups.has(storeName)) groups.set(storeName, []);
    groups.get(storeName).push(item);
  });
  const groupedMarkup = [...groups.entries()].map(([storeName, groupItems]) => `
    <section class="list-store-group" aria-label="${escapeAttr(storeName)}">
      <div class="list-store-heading">
        <h2>${escapeHtml(storeName)}</h2>
        <span>${groupItems.length} item${groupItems.length === 1 ? '' : 's'}</span>
      </div>
      ${groupItems.map(itemMarkup).join('')}
    </section>`).join('');
  container.innerHTML = filterBar + groupedMarkup;
}

function updateListFilterDot() {
  const f = listState.filter;
  const active = f.storeId || f.category;
  const dot = document.getElementById('list-filter-dot');
  if (dot) dot.style.display = active ? '' : 'none';
}

function clearListFilter() {
  listState.filter = { storeId: null, category: null };
  renderShoppingList();
}

function renderStoreSummary(items) {
  const container = document.getElementById('list-summary');
  if (!items.length) { container.innerHTML = ''; return; }
  const context = items.find(item => item.priceContext)?.priceContext;
  if (!context) { container.innerHTML = ''; return; }
  const usualName = context.usualStore?.name;
  const additionalName = context.additionalStore?.name;
  const savings = Number(context.estimatedAdditionalStopSavings || 0);
  const threshold = Number(context.savingsThreshold || 0);
  const freshnessDays = Number(context.freshnessDays || 30);
  const tripMessage = usualName
    ? `Start at <strong>${escapeHtml(usualName)}</strong>.`
    : 'Choose your usual store in Household settings to build one practical trip.';
  const savingsMessage = additionalName && savings >= threshold
    ? `<div class="store-summary-recommendation">A stop at <strong>${escapeHtml(additionalName)}</strong> saves about <strong>${formatCurrency(savings)}</strong> across this list.</div>`
    : `<div class="text-muted">Another stop appears only when estimated savings reach ${formatCurrency(threshold)}.</div>`;
  container.innerHTML = `
    <h3>Your trip plan</h3>
    <div>${tripMessage}</div>
    ${savingsMessage}
    <div class="store-summary-freshness">Prices older than ${freshnessDays} days are marked stale and excluded from recommendations.</div>`;
}

// =============================================================
// Instant check-off; price exceptions are handled at Done Shopping
// =============================================================

function createCartEntry(item) {
  const name = item.itemId?.name || 'Unknown item';
  const quantity = Number(item.quantity) || 1;
  const assignedStoreId = item.tripStore?._id || item.storeId?._id || item.storeId || null;
  const tripPrice = item.tripPrice && !item.tripPrice.isStale ? item.tripPrice : null;
  const priceStoreId = tripPrice?.store?._id || null;
  const canUseKnownPrice = Boolean(tripPrice && priceStoreId &&
    Number.isFinite(Number(tripPrice.pricePerUnit)) && Number(tripPrice.pricePerUnit) >= 0);
  const suggestedPrice = canUseKnownPrice
    ? Math.round((Number(tripPrice.pricePerUnit) * quantity + Number.EPSILON) * 100) / 100
    : null;

  return {
    name,
    price: suggestedPrice,
    suggestedPrice,
    quantity,
    storeId: assignedStoreId || priceStoreId,
    needsPrice: suggestedPrice === null,
    priceOptions: item.priceOptions || []
  };
}

function handleListItemCheck(id, willBeChecked) {
  const item = listState.items.find(i => i._id === id);
  if (!item) return;
  let sync = checkSyncState.get(id);
  if (!sync) {
    sync = { serverChecked: Boolean(item.checked), desiredChecked: Boolean(item.checked), processing: false };
    checkSyncState.set(id, sync);
  }
  sync.desiredChecked = Boolean(willBeChecked);
  item.checked = sync.desiredChecked;
  if (item.checked) cartState.set(id, createCartEntry(item));
  else cartState.delete(id);
  renderShoppingList();
  document.querySelector(`.list-item[data-id="${CSS.escape(id)}"] .list-item-check-wrap`)?.focus({ preventScroll: true });
  if (!sync.processing) sync.promise = persistListItemCheck(id);
}

async function persistListItemCheck(id) {
  const sync = checkSyncState.get(id);
  if (!sync || sync.processing) return;
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

// =============================================================
// Cart bar
// =============================================================

function updateCartBar() {
  const bar = document.getElementById('cart-bar');
  const label = document.getElementById('cart-bar-label');
  const tab = document.getElementById('tab-list');
  if (!bar) return;

  if (cartState.size === 0) {
    activeTripKey = null;
    bar.style.display = 'none';
    tab?.classList.remove('has-cart');
    const detail = document.getElementById('cart-bar-detail');
    const summary = document.getElementById('cart-bar-summary');
    if (detail) detail.style.display = 'none';
    summary?.setAttribute('aria-expanded', 'false');
    document.getElementById('cart-more-menu')?.removeAttribute('open');
    return;
  }

  let total = 0;
  let missingPrices = 0;
  cartState.forEach(entry => {
    total += entry.price || 0;
    if (entry.needsPrice) missingPrices++;
  });
  const count = cartState.size;

  bar.style.display = '';
  tab?.classList.add('has-cart');
  if (label) {
    const review = missingPrices ? ` · ${missingPrices} need price${missingPrices === 1 ? '' : 's'}` : '';
    label.textContent = `In cart: ${formatCurrency(total)} (${count} item${count !== 1 ? 's' : ''})${review}`;
  }
  const doneButton = document.getElementById('btn-done-shopping');
  if (doneButton) {
    doneButton.disabled = false;
    doneButton.setAttribute('aria-label', `Done shopping with ${count} item${count === 1 ? '' : 's'}`);
  }

  const detail = document.getElementById('cart-bar-detail');
  if (detail && detail.style.display !== 'none') {
    renderCartDetail(detail);
  }
}

function renderCartDetail(container) {
  let total = 0;
  const rows = [];
  cartState.forEach((entry, id) => {
    total += entry.price || 0;
    rows.push(`<div class="cart-detail-row">
      <span>${entry.name}</span>
      <span>${entry.needsPrice ? 'Price needed' : formatCurrency(entry.price)}</span>
    </div>`);
  });
  rows.push(`<div class="cart-detail-row cart-detail-total">
    <span>Total</span><span>${formatCurrency(total)}</span>
  </div>`);
  container.innerHTML = rows.join('');
}

function openDoneShoppingReview() {
  const checkedItems = listState.items.filter(item => item.checked);
  if (!checkedItems.length) { showToast('No items checked off'); return; }

  checkedItems.forEach(item => {
    if (!cartState.has(item._id)) cartState.set(item._id, createCartEntry(item));
  });
  activeTripKey ||= typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const storeCounts = new Map();
  cartState.forEach(entry => {
    if (entry.storeId) storeCounts.set(entry.storeId, (storeCounts.get(entry.storeId) || 0) + 1);
  });
  const initialStoreId = [...storeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const storeOptions = listState.stores.map(store => `
    <option value="${escapeAttr(store._id)}"${initialStoreId === store._id ? ' selected' : ''}>${escapeHtml(store.name)}</option>
  `).join('');

  openModal('Review shopping trip', `
    <div class="trip-review-summary">
      <strong id="trip-review-total"></strong>
      <p class="text-muted text-sm" id="trip-review-detail">Known prices are prefilled. Edit only the exceptions.</p>
    </div>
    <div class="form-group trip-store-once">
      <label for="trip-store-select">Where did you shop?</label>
      <select class="form-control" id="trip-store-select">
        <option value="">Choose one store for this trip</option>
        ${storeOptions}
      </select>
    </div>
    <div id="trip-review-status"></div>
    <section class="trip-exceptions-section" aria-labelledby="trip-exceptions-heading">
      <h3 id="trip-exceptions-heading">Price exceptions</h3>
      <p class="text-muted text-sm">Only missing or changed prices need attention.</p>
      <div id="trip-price-exceptions" class="trip-review-items"></div>
      <p id="trip-no-exceptions" class="trip-no-exceptions">No price exceptions.</p>
    </section>
    <details id="trip-known-prices" class="trip-known-prices">
      <summary id="trip-known-prices-summary">Known prices</summary>
      <p class="text-muted text-sm">Open only if a shelf price changed.</p>
      <div id="trip-known-price-items" class="trip-review-items"></div>
    </details>
    <label class="trip-pantry-option">
      <input type="checkbox" id="trip-add-to-pantry" checked />
      <span><strong>Replenish Pantry</strong><small>Mark purchased items as Have and add any tracked quantities.</small></span>
    </label>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Keep shopping</button>
      <button type="button" class="btn btn-primary" id="btn-finish-trip">Finish trip</button>
    </div>`);

  document.getElementById('trip-store-select')?.addEventListener('change', event => {
    renderTripPriceRows(checkedItems, event.target.value);
  });
  renderTripPriceRows(checkedItems, initialStoreId);
  document.getElementById('btn-finish-trip')?.addEventListener('click', finishShoppingTrip);
  registerDirtyForm(finishShoppingTrip);
}

function knownLinePriceForStore(entry, storeId) {
  if (!storeId) return null;
  const option = (entry.priceOptions || []).find(price =>
    !price.isStale && String(price.store?._id) === String(storeId) &&
    Number.isFinite(Number(price.pricePerUnit)) && Number(price.pricePerUnit) >= 0
  );
  if (!option) return null;
  return Math.round((Number(option.pricePerUnit) * entry.quantity + Number.EPSILON) * 100) / 100;
}

function tripPriceRow(item, entry, suggestedPrice) {
  const isKnown = suggestedPrice !== null;
  return `
    <div class="trip-review-item" data-list-item-id="${escapeAttr(item._id)}" data-original-known="${isKnown}">
      <div class="trip-review-item-heading">
        <strong>${escapeHtml(entry.name)}</strong>
        <span class="text-muted text-sm">qty ${entry.quantity}</span>
      </div>
      <label class="trip-price-field">
        <span>Price paid</span>
        <input class="form-control trip-price-input" type="number" inputmode="decimal"
          step="0.01" min="0" placeholder="Add later"
          value="${isKnown ? escapeAttr(Number(suggestedPrice).toFixed(2)) : ''}"
          data-suggested-price="${isKnown ? escapeAttr(suggestedPrice) : ''}"
          aria-label="Price paid for ${escapeAttr(entry.name)}" />
      </label>
      <span class="trip-exception-label" ${isKnown ? 'hidden' : ''}>Missing price</span>
    </div>`;
}

function renderTripPriceRows(checkedItems, storeId) {
  const exceptions = document.getElementById('trip-price-exceptions');
  const known = document.getElementById('trip-known-price-items');
  if (!exceptions || !known) return;
  exceptions.innerHTML = '';
  known.innerHTML = '';
  checkedItems.forEach(item => {
    const entry = cartState.get(item._id);
    const suggestedPrice = knownLinePriceForStore(entry, storeId);
    entry.storeId = storeId || null;
    entry.suggestedPrice = suggestedPrice;
    entry.price = suggestedPrice;
    entry.needsPrice = suggestedPrice === null;
    const template = document.createElement('template');
    template.innerHTML = tripPriceRow(item, entry, suggestedPrice).trim();
    const row = template.content.firstElementChild;
    (suggestedPrice === null ? exceptions : known).appendChild(row);
  });
  document.querySelectorAll('.trip-price-input').forEach(input => {
    input.addEventListener('input', handleTripPriceEdit);
    input.addEventListener('change', handleTripPriceEdit);
  });
  refreshTripPriceSections();
  updateTripReviewSummary();
}

function handleTripPriceEdit(event) {
  const input = event.currentTarget;
  const row = input.closest('.trip-review-item');
  const suggested = input.dataset.suggestedPrice === '' ? null : Number(input.dataset.suggestedPrice);
  const rawPrice = input.value.trim();
  const price = rawPrice === '' ? null : Number(rawPrice);
  const changedKnownPrice = row.dataset.originalKnown === 'true' && (
    price === null || !Number.isFinite(price) || Math.abs(price - suggested) >= 0.005
  );
  const label = row.querySelector('.trip-exception-label');
  if (changedKnownPrice) {
    label.hidden = false;
    label.textContent = price === null ? 'Price removed' : 'Changed price';
    document.getElementById('trip-price-exceptions')?.appendChild(row);
  } else if (row.dataset.originalKnown === 'true') {
    label.hidden = true;
    document.getElementById('trip-known-price-items')?.appendChild(row);
  }
  refreshTripPriceSections();
  updateTripReviewSummary();
}

function refreshTripPriceSections() {
  const knownCount = document.getElementById('trip-known-price-items')?.children.length || 0;
  const exceptionCount = document.getElementById('trip-price-exceptions')?.children.length || 0;
  const knownDetails = document.getElementById('trip-known-prices');
  const knownSummary = document.getElementById('trip-known-prices-summary');
  const noExceptions = document.getElementById('trip-no-exceptions');
  if (knownDetails) knownDetails.style.display = knownCount ? '' : 'none';
  if (knownSummary) knownSummary.textContent = `${knownCount} known price${knownCount === 1 ? '' : 's'} · collapsed`;
  if (noExceptions) noExceptions.style.display = exceptionCount ? 'none' : '';
}

function updateTripReviewSummary() {
  const rows = [...document.querySelectorAll('.trip-review-item')];
  const storeId = document.getElementById('trip-store-select')?.value || null;
  let total = 0;
  let missingPrices = 0;
  let changedPrices = 0;
  const missingStore = !storeId;

  rows.forEach(row => {
    const input = row.querySelector('.trip-price-input');
    const rawPrice = input.value.trim();
    const price = rawPrice === '' ? null : Number(rawPrice);
    const suggestedRaw = input.dataset.suggestedPrice;
    const suggested = suggestedRaw === '' ? null : Number(suggestedRaw);
    if (price === null || !Number.isFinite(price)) {
      missingPrices++;
    } else {
      total += price;
      if (suggested !== null && Math.abs(price - suggested) >= 0.005) changedPrices++;
    }

    const entry = cartState.get(row.dataset.listItemId);
    if (entry) {
      entry.price = price !== null && Number.isFinite(price) ? price : null;
      entry.storeId = storeId;
      entry.needsPrice = entry.price === null;
    }
  });

  const totalEl = document.getElementById('trip-review-total');
  if (totalEl) totalEl.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'} · ${formatCurrency(total)}`;
  const detailParts = [];
  if (missingPrices) detailParts.push(`${missingPrices} need price${missingPrices === 1 ? '' : 's'}`);
  if (changedPrices) detailParts.push(`${changedPrices} price${changedPrices === 1 ? '' : 's'} changed`);
  if (missingStore) detailParts.push('choose the trip store');
  const detailEl = document.getElementById('trip-review-detail');
  if (detailEl) {
    detailEl.textContent = detailParts.length
      ? detailParts.join(' · ')
      : 'Known prices are prefilled. Edit only the exceptions.';
  }

  const status = document.getElementById('trip-review-status');
  if (!status) return;
  if (missingPrices) {
    status.className = 'trip-review-warning';
    status.innerHTML = `<strong>${missingPrices} item${missingPrices === 1 ? '' : 's'} need${missingPrices === 1 ? 's' : ''} prices</strong>
      <p>You can add them now or finish and record them later.</p>`;
  } else if (missingStore) {
    status.className = 'trip-review-warning';
    status.innerHTML = '<strong>Choose the trip store</strong><p>Provista applies it to every purchased item once.</p>';
  } else {
    status.className = 'trip-review-ready';
    status.textContent = 'All item prices are accounted for.';
  }
}

async function finishShoppingTrip() {
  const button = document.getElementById('btn-finish-trip');
  if (button) { button.disabled = true; button.textContent = 'Finishing…'; }
  if (!(await settlePendingCheckWrites())) {
    if (button) { button.disabled = false; button.textContent = 'Finish trip'; }
    showToast('One check-off could not be saved. Review the list and try again.');
    return;
  }
  const checkedItems = listState.items.filter(item => item.checked);
  const purchases = [];
  const storeSelect = document.getElementById('trip-store-select');
  const storeId = storeSelect?.value || null;
  if (!storeId) {
    showToast('Choose the store for this trip');
    storeSelect?.focus();
    if (button) { button.disabled = false; button.textContent = 'Finish trip'; }
    return;
  }

  for (const item of checkedItems) {
    const row = document.querySelector(`.trip-review-item[data-list-item-id="${CSS.escape(item._id)}"]`);
    if (!row) continue;
    const input = row.querySelector('.trip-price-input');
    const rawPrice = input.value.trim();
    const price = rawPrice === '' ? null : Number(rawPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      showToast(`Enter a valid price for ${cartState.get(item._id)?.name || 'this item'}`);
      input.focus();
      if (button) { button.disabled = false; button.textContent = 'Finish trip'; }
      return;
    }
    purchases.push({ listItemId: item._id, price, storeId });
  }

  try {
    const result = await api.shoppingList.complete({
      idempotencyKey: activeTripKey,
      purchases,
      addToPantry: document.getElementById('trip-add-to-pantry')?.checked !== false
    });
    checkedItems.forEach(item => cartState.delete(item._id));
    activeTripKey = null;
    closeModal();
    await loadShoppingListTab();
    const details = [];
    if (result.pantryUpdated) details.push('Pantry updated');
    if (result.pendingPriceCount) details.push(`${result.pendingPriceCount} price${result.pendingPriceCount === 1 ? '' : 's'} pending review`);
    if (result.missingPriceCount) details.push(`${result.missingPriceCount} still need${result.missingPriceCount === 1 ? 's' : ''} a price`);
    const suffix = details.length ? ` · ${details.join(' · ')}` : '';
    showToast(`Trip complete! ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} · ${formatCurrency(result.total)} added to Spend${suffix}`, 6000);
  } catch (err) {
    handleError(err, 'Failed to finish shopping trip');
    if (button) { button.disabled = false; button.textContent = 'Finish trip'; }
  }
}

// =============================================================
// List item CRUD
// =============================================================

async function removeListItem(id) {
  const item = listState.items.find(entry => entry._id === id);
  const name = item?.itemId?.name || 'this item';
  if (!confirm(`Remove ${name} from the shopping list?`)) return;
  try {
    await api.shoppingList.delete(id);
    cartState.delete(id);
    listState.items = listState.items.filter(i => i._id !== id);
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to remove item');
  }
}

function openAddListItemModal() {
  const storeOptions = listState.stores.map(s =>
    `<option value="${escapeAttr(s._id)}">${escapeHtml(s.name)}</option>`
  ).join('');

  const bodyHTML = `
    <form id="add-list-form">
      <div class="form-group">
        <label>Item</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="list-item-input" placeholder="Search or create item..." autocomplete="off" required />
          <div class="autocomplete-dropdown" id="list-item-dropdown"></div>
        </div>
        <input type="hidden" id="list-item-id" />
      </div>
      ${inlineItemCreationFields('list')}
      <div class="form-group">
        <label>Quantity</label>
        <input class="form-control" type="number" id="list-qty" value="1" min="1" step="1" required />
      </div>
      ${storeOptions ? `
      <div class="form-group">
        <label>Preferred Store <span class="text-muted text-sm">(optional)</span></label>
        <select class="form-control" id="list-store-select">
          <option value="">Any store</option>
          ${storeOptions}
        </select>
      </div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to List</button>
      </div>
    </form>`;

  openModal('Add to Shopping List', bodyHTML);

  const itemInput = document.getElementById('list-item-input');
  const itemDropdown = document.getElementById('list-item-dropdown');
  let selectedItemName = '';
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) {
      selectedItemName = item.name;
      document.getElementById('list-item-id').value = item._id;
      clearInlineItemCreation('list');
    },
    onCreateNew: (name) => {
      selectedItemName = '';
      startInlineItemCreation('list', name, 'list-item-input', 'list-item-id');
    }
  });
  itemInput.addEventListener('input', () => {
    if (document.getElementById('list-new-item-mode')?.value === 'true') return;
    if (selectedItemName && itemInput.value !== selectedItemName) {
      document.getElementById('list-item-id').value = '';
    }
  });

  document.getElementById('add-list-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let itemId = document.getElementById('list-item-id').value;
    const qty = parseInt(document.getElementById('list-qty').value);
    const storeId = document.getElementById('list-store-select')?.value || null;
    const submit = formSubmitButton(e.target);
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
      closeModal();
      showToast('Added to list');
      await loadShoppingListTab();
    } catch (err) {
      handleError(err, 'Failed to add item');
      submit.disabled = false;
      submit.textContent = 'Add to List';
    }
  });
}

function openStorePickerForItem(id) {
  const item = listState.items.find(i => i._id === id);
  if (!item) return;
  const currentStoreId = item.storeId?._id || item.storeId || '';
  const options = listState.stores.map(s =>
    `<option value="${escapeAttr(s._id)}"${s._id === currentStoreId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  openModal('Preferred Store', `
    <form id="store-picker-form">
      <div class="form-group">
        <select class="form-control" id="store-picker-select">
          <option value="">Any store</option>
          ${options}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  document.getElementById('store-picker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const storeId = document.getElementById('store-picker-select').value || null;
    try {
      await api.shoppingList.update(id, { storeId: storeId || null });
      const store = storeId ? listState.stores.find(s => s._id === storeId) : null;
      item.storeId = store || null;
      closeModal();
      renderShoppingList();
    } catch (err) {
      handleError(err, 'Failed to update store');
    }
  });
}

function openListFilterSheet() {
  const f = listState.filter;
  const stores = listState.stores;
  const categories = [...new Set(listState.items.map(i => i.itemId?.category).filter(Boolean))].sort();

  const storeChips = stores.map(s =>
    `<button class="filter-chip${f.storeId === s._id ? ' selected' : ''}" data-store-id="${escapeAttr(s._id)}" onclick="toggleListFilterStore(this)">${escapeHtml(s.name)}</button>`
  ).join('');
  const catChips = categories.map(c =>
    `<button class="filter-chip${f.category === c ? ' selected' : ''}" data-cat="${escapeAttr(c)}" onclick="toggleListFilterCat(this)">${escapeHtml(c)}</button>`
  ).join('');

  document.getElementById('filter-sheet-title').textContent = 'Filter List';
  document.getElementById('filter-sheet-body').innerHTML = `
    ${stores.length ? `<div><div class="filter-section-label">Store</div><div class="filter-chips">${storeChips}</div></div>` : ''}
    ${categories.length ? `<div><div class="filter-section-label">Category</div><div class="filter-chips">${catChips}</div></div>` : ''}
    ${!stores.length && !categories.length ? '<p class="text-muted text-sm">No stores or categories to filter by.</p>' : ''}
  `;

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
  overlay.onclick = (e) => {
    if (e.target === overlay) closeAndApply();
  };
}

function closeListFilterSheet() {
  deactivateDialogSurface(document.getElementById('filter-sheet-overlay'), document.getElementById('filter-sheet'));
}

function toggleListFilterStore(btn) {
  const id = btn.dataset.storeId;
  const wasSelected = btn.classList.contains('selected');
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  listState.filter.storeId = wasSelected ? null : id;
  if (!wasSelected) btn.classList.add('selected');
}

function toggleListFilterCat(btn) {
  const cat = btn.dataset.cat;
  const wasSelected = btn.classList.contains('selected');
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  listState.filter.category = wasSelected ? null : cat;
  if (!wasSelected) btn.classList.add('selected');
}

// =============================================================
// Deselect All
// =============================================================

async function deselectAll() {
  const checked = listState.items.filter(i => i.checked);
  if (!checked.length) { showToast('No checked items'); return; }
  checked.forEach(item => handleListItemCheck(item._id, false));
  if (await settlePendingCheckWrites()) showToast('All items unchecked');
}

async function removeCheckedWithoutRecording(event) {
  const count = listState.items.filter(item => item.checked).length;
  if (!count) { showToast('No checked items'); return; }
  if (!confirm(`Remove ${count} checked item${count === 1 ? '' : 's'} without updating Pantry, Spend, or price history?`)) return;
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    if (!(await settlePendingCheckWrites())) {
      showToast('A check-off could not be saved. Review the list and try again.');
      return;
    }
    listState.items.filter(item => item.checked).forEach(item => cartState.delete(item._id));
    await api.shoppingList.clear(true);
    await loadShoppingListTab();
    showToast('Checked items removed without recording');
  } catch (err) {
    handleError(err, 'Failed to remove checked items');
  } finally {
    if (button) button.disabled = false;
  }
}

// =============================================================
// Low Stock Badge & Review Sheet
// =============================================================

async function loadLowStockBadge() {
  const btn = document.getElementById('btn-low-stock');
  const countEl = document.getElementById('low-stock-count');
  if (!btn) return;
  try {
    const items = await api.request('GET', '/inventory/low-stock');
    const count = items.length;
    if (count > 0) {
      btn.style.display = '';
      if (countEl) countEl.textContent = count;
    } else {
      btn.style.display = 'none';
    }
    btn._lowStockItems = items;
  } catch (_) {
    btn.style.display = 'none';
  }
}

function openLowStockReview() {
  const btn = document.getElementById('btn-low-stock');
  const items = btn?._lowStockItems || [];
  if (!items.length) { showToast('No low stock items'); return; }

  // Get IDs already on the shopping list
  const onListIds = new Set(listState.items.map(i => i.itemId?._id || i.itemId));

  const bodyHTML = `
    <p class="text-muted text-sm" style="margin-bottom:0.75rem">
      Select items to add to your shopping list.
    </p>
    <div id="low-stock-list">
      ${items.map(inv => {
        const itemId = inv.itemId?._id || inv.itemId;
        const name = inv.itemId?.name || 'Unknown';
        const unit = inv.unit || inv.itemId?.unit || '';
        const alreadyOn = onListIds.has(itemId);
        return `
          <div class="card" style="margin-bottom:0.5rem">
            <div class="card-body">
              <div class="card-title">${name}${inv.itemId?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(inv.itemId.brand) + ')</span>' : ''}</div>
              <div class="card-subtitle">
                ${inv.quantity} / ${inv.lowStockThreshold} ${unit} remaining
                ${alreadyOn ? '<span class="badge badge-no-data">Already on list</span>' : ''}
              </div>
            </div>
            <label class="low-stock-choice">
              <input type="checkbox" class="low-stock-check" data-id="${itemId}"
                ${alreadyOn ? 'checked' : ''} aria-label="Add ${escapeAttr(name)} to the shopping list" />
            </label>
          </div>`;
      }).join('')}
    </div>
    <div class="form-actions" style="margin-top:0.75rem">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-add-low-stock">Add Selected to List</button>
    </div>`;

  openModal('Low Stock Review', bodyHTML);

  document.getElementById('btn-add-low-stock').addEventListener('click', async () => {
    const checks = document.querySelectorAll('.low-stock-check:checked');
    const toAdd = [];
    checks.forEach(cb => {
      const itemId = cb.dataset.id;
      if (!onListIds.has(itemId)) toAdd.push(itemId);
    });
    if (!toAdd.length) { closeModal(); return; }
    try {
      await Promise.all(toAdd.map(itemId => api.shoppingList.add({ itemId, quantity: 1 })));
      closeModal();
      showToast(`Added ${toAdd.length} item${toAdd.length !== 1 ? 's' : ''} to list`);
      await loadShoppingListTab();
    } catch (err) {
      handleError(err, 'Failed to add items');
    }
  });
}

// =============================================================
// Init
// =============================================================

function initShoppingListTab() {
  // Start hidden; renderShoppingList() reveals list-wide actions when needed.
  document.getElementById('btn-clear-all').style.display = 'none';

  document.getElementById('btn-add-list-item').addEventListener('click', openAddListItemModal);
  document.getElementById('btn-list-filter')?.addEventListener('click', openListFilterSheet);

  const scanListBtn = document.getElementById('btn-scan-list-item');
  if (scanListBtn) {
    if (!window.appAuth?.features?.barcodeScanning) {
      scanListBtn.style.display = 'none';
    } else {
      scanListBtn.addEventListener('click', () => {
        if (!window.BarcodeScanner) { showToast('Scanner unavailable. Try reloading the page.', 3000); return; }
        BarcodeScanner.open(async (upc) => {
          if (!upc) return;
          await handleBarcodeResult(upc, async (item) => {
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

  // Cart bar expand/collapse
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

  document.getElementById('btn-clear-all').addEventListener('click', async (e) => {
    if (!listState.items.length) { showToast('List is already empty'); return; }
    if (!confirm('Clear the entire shopping list?')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await settlePendingCheckWrites();
      cartState.clear();
      await api.shoppingList.clear(false);
      await loadShoppingListTab();
      showToast('List cleared');
    } catch (err) {
      handleError(err, 'Failed to clear list');
    } finally {
      btn.disabled = false;
    }
  });
}
