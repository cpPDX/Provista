// Shopping List tab logic

let listState = { items: [] };

// Cart state: confirmed prices while shopping. In-memory, cleared when list is cleared.
const cartState = new Map(); // listItemId → { name, price, quantity }

// Guard against rapid double-taps on the same item's checkbox
const pendingCheckIds = new Set();

// =============================================================
// Loading & Rendering
// =============================================================

async function loadShoppingListTab() {
  try {
    listState.items = await api.shoppingList.list();
    renderShoppingList();
    loadLowStockBadge();
  } catch (err) {
    handleError(err, 'Failed to load shopping list');
  }
}

function renderShoppingList() {
  const items = listState.items;
  renderStoreSummary(items);

  // Keep cart bar in sync with the current checked state
  items.forEach(item => {
    if (!item.checked && cartState.has(item._id)) {
      cartState.delete(item._id);
    }
  });
  updateCartBar();

  const container = document.getElementById('shopping-list');

  // Show/hide clear buttons based on list state
  const hasItems = items.length > 0;
  const hasChecked = items.some(i => i.checked);
  const clearCheckedBtn = document.getElementById('btn-clear-checked');
  const clearAllBtn = document.getElementById('btn-clear-all');
  const deselectAllBtn = document.getElementById('btn-deselect-all');
  if (clearCheckedBtn) clearCheckedBtn.style.display = hasChecked ? '' : 'none';
  if (clearAllBtn) clearAllBtn.style.display = hasItems ? '' : 'none';
  if (deselectAllBtn) deselectAllBtn.style.display = hasChecked ? '' : 'none';

  if (!items.length) {
    container.innerHTML = emptyState('📋', 'Your shopping list is empty. Tap "+ Add" to start.');
    return;
  }

  container.innerHTML = items.map(item => {
    const name = item.itemId?.name || 'Unknown item';
    const unit = item.itemId?.unit || '';
    const cat = item.itemId?.category || '';
    const checked = item.checked;
    const cartEntry = cartState.get(item._id);

    let priceInfo = '';
    if (cartEntry) {
      priceInfo = `<div class="card-subtitle text-success">In cart: ${formatCurrency(cartEntry.price)}</div>`;
    } else if (item.bestPrice) {
      const { store, pricePerUnit } = item.bestPrice;
      priceInfo = `<div class="card-subtitle text-success">${store?.name} &mdash; ${formatPPU(pricePerUnit, unit)}</div>`;
    } else {
      priceInfo = `<span class="badge badge-no-data">No price data</span>`;
    }

    return `
      <div class="card list-item ${checked ? 'checked' : ''}" data-id="${item._id}">
        <div class="list-item-check-wrap" onclick="handleListItemCheck('${item._id}', ${!checked})">
          <div class="list-item-check ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</div>
        </div>
        <div class="card-body">
          <div class="card-title">${name}${item.itemId?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(item.itemId.brand) + ')</span>' : ''}</div>
          <div class="list-item-meta">${item.itemId ? formatItemMeta(item.itemId) : cat} &middot; qty ${item.quantity}</div>
          <div class="list-item-meta">Added by ${item.addedBy?.name || 'unknown'}</div>
          ${priceInfo}
        </div>
        <button class="btn btn-icon text-danger" onclick="removeListItem('${item._id}')" style="font-size:1rem;min-height:32px;min-width:32px">✕</button>
      </div>`;
  }).join('');
}

function renderStoreSummary(items) {
  const container = document.getElementById('list-summary');
  if (!items.length) { container.innerHTML = ''; return; }

  const storeCounts = {};
  let noDataCount = 0;

  items.forEach(item => {
    if (item.bestPrice) {
      const name = item.bestPrice.store?.name || 'Unknown';
      storeCounts[name] = (storeCounts[name] || 0) + 1;
    } else {
      noDataCount++;
    }
  });

  const lines = Object.entries(storeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <div class="store-summary-item">
        <span>${name}</span>
        <span class="text-muted">${count} item${count !== 1 ? 's' : ''}</span>
      </div>`).join('');

  const noDataLine = noDataCount > 0 ? `
    <div class="store-summary-item">
      <span class="text-muted">No price data</span>
      <span class="text-muted">${noDataCount} item${noDataCount !== 1 ? 's' : ''}</span>
    </div>` : '';

  container.innerHTML = `<h3>Best prices found at:</h3>${lines}${noDataLine}`;
}

// =============================================================
// Check-off with price confirmation
// =============================================================

function handleListItemCheck(id, willBeChecked) {
  if (pendingCheckIds.has(id)) return;
  const item = listState.items.find(i => i._id === id);
  if (!item) return;

  if (!willBeChecked) {
    // Unchecking — remove from cart and update immediately
    cartState.delete(id);
    toggleListItem(id, false);
    return;
  }

  // Checking — show price confirmation sheet
  const name = item.itemId?.name || 'Unknown item';
  const qty = item.quantity || 1;
  const unit = item.itemId?.unit || '';

  // Estimate best known price: bestPrice.finalPrice or pricePerUnit * qty
  const knownPrice = item.bestPrice
    ? (item.bestPrice.finalPrice != null
        ? item.bestPrice.finalPrice
        : (item.bestPrice.pricePerUnit || 0) * qty)
    : null;

  showPriceConfirmSheet(id, name, qty, unit, knownPrice);
}

function showPriceConfirmSheet(listItemId, name, qty, unit, knownPrice) {
  const hasPrice = knownPrice != null && knownPrice > 0;
  const priceStr = hasPrice ? formatCurrency(knownPrice) : '';

  const bodyHTML = `
    <div style="text-align:center;padding:0.25rem 0 0.75rem">
      <div style="font-size:1.125rem;font-weight:700">${escapeHtml(name)}</div>
      <div class="text-muted text-sm">qty ${qty}${unit ? ' ' + escapeHtml(unit) : ''}</div>
    </div>
    ${hasPrice ? `
      <p style="text-align:center;margin-bottom:1rem">Did you pay <strong>${priceStr}</strong>?</p>
      <div class="form-actions">
        <button class="btn btn-outline" id="btn-cart-update-price">Update Price</button>
        <button class="btn btn-primary" id="btn-cart-confirm">Confirm ${priceStr}</button>
      </div>
    ` : `
      <div class="form-group">
        <label>What did you pay?</label>
        <input class="form-control" type="number" id="cart-price-input" step="0.01" min="0"
          placeholder="0.00" style="font-size:1.25rem;text-align:center" />
      </div>
      <div class="form-actions">
        <button class="btn btn-outline" onclick="closeModal()">Skip</button>
        <button class="btn btn-primary" id="btn-cart-confirm-new">Add to Cart</button>
      </div>
    `}`;

  openModal(`Check off: ${name}`, bodyHTML);

  if (hasPrice) {
    document.getElementById('btn-cart-confirm').addEventListener('click', () => {
      cartState.set(listItemId, { name, price: knownPrice, quantity: qty });
      closeModal();
      toggleListItem(listItemId, true);
    });

    document.getElementById('btn-cart-update-price').addEventListener('click', () => {
      // Clear the close callback first so the dismiss-without-confirm path doesn't fire early
      window._modalCloseCallback = null;
      closeModal();
      const listItem = listState.items.find(i => i._id === listItemId);
      const prefillItem = listItem?.itemId ? { ...listItem.itemId } : null;
      if (prefillItem) {
        openAddPriceModal(prefillItem, (savedPrice) => {
          const confirmedPrice = savedPrice?.finalPrice ?? knownPrice;
          cartState.set(listItemId, { name, price: confirmedPrice, quantity: qty });
          toggleListItem(listItemId, true);
        });
      } else {
        cartState.set(listItemId, { name, price: knownPrice, quantity: qty });
        toggleListItem(listItemId, true);
      }
    });
  } else {
    document.getElementById('btn-cart-confirm-new')?.addEventListener('click', () => {
      const input = document.getElementById('cart-price-input');
      const price = parseFloat(input?.value) || 0;
      cartState.set(listItemId, { name, price, quantity: qty });
      closeModal();
      toggleListItem(listItemId, true);
    });

    // Allow skip by pressing enter with empty value
    document.getElementById('cart-price-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-cart-confirm-new')?.click();
    });
  }

  // If user closes modal without confirming, check off without price
  const originalClose = window._modalCloseCallback;
  window._modalCloseCallback = () => {
    if (!cartState.has(listItemId)) {
      toggleListItem(listItemId, true);
    }
    window._modalCloseCallback = originalClose;
  };
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
    bar.style.display = 'none';
    tab?.classList.remove('has-cart');
    return;
  }

  let total = 0;
  cartState.forEach(entry => { total += entry.price; });
  const count = cartState.size;

  bar.style.display = '';
  tab?.classList.add('has-cart');
  if (label) label.textContent = `In cart: ${formatCurrency(total)} (${count} item${count !== 1 ? 's' : ''})`;

  const detail = document.getElementById('cart-bar-detail');
  if (detail && detail.style.display !== 'none') {
    renderCartDetail(detail);
  }
}

function renderCartDetail(container) {
  let total = 0;
  const rows = [];
  cartState.forEach((entry, id) => {
    total += entry.price;
    rows.push(`<div class="cart-detail-row">
      <span>${entry.name}</span>
      <span>${formatCurrency(entry.price)}</span>
    </div>`);
  });
  rows.push(`<div class="cart-detail-row cart-detail-total">
    <span>Total</span><span>${formatCurrency(total)}</span>
  </div>`);
  container.innerHTML = rows.join('');
}

// =============================================================
// List item CRUD
// =============================================================

async function toggleListItem(id, checked) {
  pendingCheckIds.add(id);
  try {
    await api.shoppingList.update(id, { checked });
    const item = listState.items.find(i => i._id === id);
    if (item) item.checked = checked;
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to update item');
  } finally {
    pendingCheckIds.delete(id);
  }
}

async function removeListItem(id) {
  cartState.delete(id);
  try {
    await api.shoppingList.delete(id);
    listState.items = listState.items.filter(i => i._id !== id);
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to remove item');
  }
}

function openAddListItemModal() {
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
      <div class="form-group">
        <label>Quantity</label>
        <input class="form-control" type="number" id="list-qty" value="1" min="1" step="1" required />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to List</button>
      </div>
    </form>`;

  openModal('Add to Shopping List', bodyHTML);

  const itemInput = document.getElementById('list-item-input');
  const itemDropdown = document.getElementById('list-item-dropdown');
  const isAdmin = window.appAuth?.isAdmin();
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) { document.getElementById('list-item-id').value = item._id; },
    onCreateNew: isAdmin ? (name) => {
      promptCreateItem(name, (item) => {
        itemInput.value = item.name;
        document.getElementById('list-item-id').value = item._id;
        openAddListItemModal();
      });
    } : null
  });

  document.getElementById('add-list-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = document.getElementById('list-item-id').value;
    if (!itemId) { showToast('Please select an item'); return; }
    const qty = parseInt(document.getElementById('list-qty').value);
    try {
      await api.shoppingList.add({ itemId, quantity: qty });
      closeModal();
      showToast('Added to list');
      await loadShoppingListTab();
    } catch (err) {
      handleError(err, 'Failed to add item');
    }
  });
}

// =============================================================
// Deselect All
// =============================================================

async function deselectAll() {
  const checked = listState.items.filter(i => i.checked);
  if (!checked.length) { showToast('No checked items'); return; }
  cartState.clear();
  try {
    await Promise.all(checked.map(i => api.shoppingList.update(i._id, { checked: false })));
    checked.forEach(i => { i.checked = false; });
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to uncheck items');
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
            <input type="checkbox" class="low-stock-check" data-id="${itemId}"
              style="width:20px;height:20px;flex-shrink:0"
              ${alreadyOn ? 'checked' : ''} />
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
  // Start hidden; renderShoppingList() reveals them when items exist
  document.getElementById('btn-clear-checked').style.display = 'none';
  document.getElementById('btn-clear-all').style.display = 'none';

  document.getElementById('btn-add-list-item').addEventListener('click', openAddListItemModal);

  const scanListBtn = document.getElementById('btn-scan-list-item');
  if (scanListBtn) {
    if (!window.appAuth?.features?.barcodeScanning) {
      scanListBtn.style.display = 'none';
    } else {
      scanListBtn.addEventListener('click', () => {
        if (!window.BarcodeScanner) return;
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

  document.getElementById('btn-done-shopping')?.addEventListener('click', async () => {
    const checkedItems = listState.items.filter(i => i.checked);
    if (!checkedItems.length) { showToast('No items checked off'); return; }

    let total = 0;
    cartState.forEach(entry => { total += entry.price; });
    const count = checkedItems.length;
    const msg = `Trip complete! ${count} item${count !== 1 ? 's' : ''} — ${formatCurrency(total)} total`;

    // Clear checked items from API and local state
    checkedItems.forEach(i => cartState.delete(i._id));
    try {
      await api.shoppingList.clear(true); // clear checked=true only
    } catch (_) {}
    await loadShoppingListTab();
    showToast(msg, 4000);
  });

  document.getElementById('btn-low-stock')?.addEventListener('click', openLowStockReview);

  // Cart bar expand/collapse
  document.getElementById('cart-bar-summary')?.addEventListener('click', () => {
    const detail = document.getElementById('cart-bar-detail');
    if (!detail) return;
    const open = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : '';
    if (!open) renderCartDetail(detail);
  });

  document.getElementById('btn-clear-checked').addEventListener('click', async (e) => {
    const count = listState.items.filter(i => i.checked).length;
    if (!count) { showToast('No checked items'); return; }
    if (!confirm(`Remove ${count} checked item${count !== 1 ? 's' : ''}?`)) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // Remove checked items from cart state too
      listState.items.filter(i => i.checked).forEach(i => cartState.delete(i._id));
      await api.shoppingList.clear(true);
      await loadShoppingListTab();
      showToast('Checked items cleared');
    } catch (err) {
      handleError(err, 'Failed to clear items');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-clear-all').addEventListener('click', async (e) => {
    if (!listState.items.length) { showToast('List is already empty'); return; }
    if (!confirm('Clear the entire shopping list?')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
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
