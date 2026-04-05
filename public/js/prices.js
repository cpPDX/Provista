// Prices tab logic

let pricesState = {
  entries: [],
  searchQuery: ''
};

async function loadPricesTab() {
  try {
    const entries = await api.prices.list();
    pricesState.entries = entries;
    renderPricesList(entries);
  } catch (err) {
    handleError(err, 'Failed to load prices');
  }
}

function renderPricesList(entries) {
  const container = document.getElementById('prices-list');
  if (!entries.length) {
    container.innerHTML = emptyState('💰', 'No price entries yet. Tap "+ Add Price" to log your first one.');
    return;
  }

  // Group by item
  const byItem = {};
  entries.forEach(e => {
    const id = e.itemId?._id || e.itemId;
    if (!byItem[id]) byItem[id] = { item: e.itemId, entries: [] };
    byItem[id].entries.push(e);
  });

  container.innerHTML = Object.values(byItem).map(({ item, entries: es }) => {
    const latest = es[0];
    const storeName = latest.storeId?.name || 'Unknown store';
    const unit = item?.unit || 'unit';
    const saleTag = latest.isOnSale ? `<span class="badge badge-sale">${latest.saleLabel || 'Sale'}</span>` : '';
    return `
      <div class="card" data-item-id="${item?._id}" onclick="openItemDetail('${item?._id}', '${(item?.name || '').replace(/'/g, "\\'")}')">
        <div class="card-body">
          <div class="card-title">${item?.name || 'Unknown item'}</div>
          <div class="card-subtitle">${item?.category || ''} &middot; ${storeName} &middot; ${formatDate(latest.date)}</div>
          <div style="margin-top:4px">${saleTag}</div>
        </div>
        <div class="card-meta">
          <div class="price-big">${formatCurrency(latest.price)}</div>
          <div class="price-unit">${formatPPU(latest.pricePerUnit, unit)}</div>
        </div>
      </div>`;
  }).join('');
}

async function openItemDetail(itemId, itemName) {
  const panel = document.getElementById('item-detail-panel');
  document.getElementById('detail-item-name').textContent = itemName;
  panel.classList.add('open');
  panel.style.display = 'block';

  // Load all detail data
  await Promise.all([
    loadDetailHistory(itemId),
    loadDetailCompare(itemId)
  ]);
}

async function loadDetailHistory(itemId) {
  const container = document.getElementById('detail-history');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const entries = await api.prices.history(itemId);
    if (!entries.length) {
      container.innerHTML = emptyState('📋', 'No price history yet.');
      return;
    }

    const unit = entries[0].itemId?.unit || 'unit';
    const minPPU = Math.min(...entries.map(e => e.pricePerUnit));

    // Callout for different package sizes
    const sizes = [...new Set(entries.map(e => e.quantity))];
    let callout = '';
    if (sizes.length > 1) {
      callout = buildCallout(entries);
    }

    container.innerHTML = callout + entries.map(e => {
      const isBest = Math.abs(e.pricePerUnit - minPPU) < 0.001;
      const saleTag = e.isOnSale ? `<span class="badge badge-sale">${e.saleLabel || 'Sale'}</span> ` : '';
      const bestTag = isBest ? `<span class="badge badge-best">Best</span>` : '';
      return `
        <div class="card" style="margin-bottom:0.5rem">
          <div class="card-body">
            <div class="card-title">${e.storeId?.name || 'Unknown'}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity}</div>
            <div style="margin-top:4px">${saleTag}${bestTag}</div>
            ${e.notes ? `<div class="text-muted text-sm" style="margin-top:4px">${e.notes}</div>` : ''}
          </div>
          <div class="card-meta">
            <div class="price-big ${isBest ? 'price-best' : ''}">${formatCurrency(e.price)}</div>
            <div class="price-unit">${formatPPU(e.pricePerUnit, unit)}</div>
            <button class="btn btn-icon text-danger" onclick="deletePriceEntry('${e._id}','${itemId}')" style="font-size:1rem;min-height:32px;min-width:32px">✕</button>
          </div>
        </div>`;
    }).join('');

    // Load trend chart too
    loadDetailTrend(itemId, entries);
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load history.');
  }
}

async function loadDetailCompare(itemId) {
  const container = document.getElementById('detail-compare');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const entries = await api.prices.compare(itemId);
    if (!entries.length) {
      container.innerHTML = emptyState('🏪', 'No store comparisons yet.');
      return;
    }
    const unit = entries[0].item?.unit || 'unit';
    const minPPU = entries[0].pricePerUnit; // already sorted asc

    let callout = '';
    if (entries.length > 1) {
      callout = buildCallout(entries);
    }

    container.innerHTML = callout + entries.map((e, i) => {
      const isBest = i === 0;
      return `
        <div class="card" style="margin-bottom:0.5rem">
          <div class="card-body">
            <div class="card-title">${e.store?.name || 'Unknown'}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity}</div>
            ${isBest ? `<span class="badge badge-best">Best price</span>` : ''}
          </div>
          <div class="card-meta">
            <div class="price-big ${isBest ? 'price-best' : ''}">${formatCurrency(e.price)}</div>
            <div class="price-unit">${formatPPU(e.pricePerUnit, unit)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load comparison.');
  }
}

function loadDetailTrend(itemId, entries) {
  if (!entries || entries.length === 0) return;

  // Group by store
  const byStore = {};
  entries.forEach(e => {
    const sid = e.storeId?._id || e.storeId;
    const sname = e.storeId?.name || 'Unknown';
    if (!byStore[sid]) byStore[sid] = { label: sname, points: [] };
    byStore[sid].points.push({ x: e.date, y: e.pricePerUnit, sale: e.isOnSale });
  });

  const datasets = Object.values(byStore).map(s => ({
    label: s.label,
    points: s.points.sort((a, b) => new Date(a.x) - new Date(b.x))
  }));

  // Draw after tab is shown
  setTimeout(() => drawLineChart('trend-chart', datasets), 50);
}

async function deletePriceEntry(entryId, itemId) {
  if (!confirm('Delete this price entry?')) return;
  try {
    await api.prices.delete(entryId);
    showToast('Entry deleted');
    await loadDetailHistory(itemId);
    await loadDetailCompare(itemId);
    await loadPricesTab();
  } catch (err) {
    handleError(err, 'Failed to delete entry');
  }
}

function openAddPriceModal(prefillItem) {
  const bodyHTML = `
    <form id="add-price-form">
      <div class="form-group">
        <label>Item</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="price-item-input" placeholder="Search or create item..." autocomplete="off"
            value="${prefillItem ? prefillItem.name : ''}" required />
          <div class="autocomplete-dropdown" id="price-item-dropdown"></div>
        </div>
        <input type="hidden" id="price-item-id" value="${prefillItem ? prefillItem._id : ''}" />
        <input type="hidden" id="price-item-unit" value="${prefillItem ? prefillItem.unit : ''}" />
      </div>
      <div class="form-group">
        <label>Store</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="price-store-input" placeholder="Search or add store..." autocomplete="off" required />
          <div class="autocomplete-dropdown" id="price-store-dropdown"></div>
        </div>
        <input type="hidden" id="price-store-id" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Price ($)</label>
          <input class="form-control" type="number" id="price-amount" step="0.01" min="0" required placeholder="0.00" />
        </div>
        <div class="form-group">
          <label>Quantity</label>
          <input class="form-control" type="number" id="price-qty" step="any" min="0.01" value="1" required />
        </div>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="form-control" type="date" id="price-date" value="${new Date().toISOString().slice(0,10)}" required />
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="price-on-sale" />
        <label for="price-on-sale">On sale</label>
      </div>
      <div class="form-group" id="sale-label-group" style="display:none">
        <label>Sale Label (optional)</label>
        <input class="form-control" id="price-sale-label" placeholder="e.g. Member deal" />
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <input class="form-control" id="price-notes" placeholder="e.g. Store brand" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Entry</button>
      </div>
    </form>`;

  openModal('Log Price', bodyHTML);

  // On sale toggle
  document.getElementById('price-on-sale').addEventListener('change', (e) => {
    document.getElementById('sale-label-group').style.display = e.target.checked ? '' : 'none';
  });

  // Item autocomplete
  const itemInput = document.getElementById('price-item-input');
  const itemDropdown = document.getElementById('price-item-dropdown');
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) {
      document.getElementById('price-item-id').value = item._id;
      document.getElementById('price-item-unit').value = item.unit;
    },
    onCreateNew(name) {
      promptCreateItem(name, (item) => {
        itemInput.value = item.name;
        document.getElementById('price-item-id').value = item._id;
        document.getElementById('price-item-unit').value = item.unit;
        openAddPriceModal(item);
      });
    }
  });

  // Store autocomplete
  const storeInput = document.getElementById('price-store-input');
  const storeDropdown = document.getElementById('price-store-dropdown');
  attachStoreAutocomplete(storeInput, storeDropdown, {
    onSelect(store) {
      document.getElementById('price-store-id').value = store._id;
    },
    onCreateNew(name) {
      promptCreateStore(name, (store) => {
        storeInput.value = store.name;
        document.getElementById('price-store-id').value = store._id;
      });
    }
  });

  // Form submit
  document.getElementById('add-price-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = document.getElementById('price-item-id').value;
    const storeId = document.getElementById('price-store-id').value;
    if (!itemId) { showToast('Please select an item from the list'); return; }
    if (!storeId) { showToast('Please select a store from the list'); return; }

    const price = parseFloat(document.getElementById('price-amount').value);
    const quantity = parseFloat(document.getElementById('price-qty').value);
    const data = {
      itemId,
      storeId,
      price,
      quantity,
      isOnSale: document.getElementById('price-on-sale').checked,
      saleLabel: document.getElementById('price-sale-label').value.trim(),
      date: document.getElementById('price-date').value,
      notes: document.getElementById('price-notes').value.trim(),
      source: 'manual'
    };
    try {
      await api.prices.create(data);
      closeModal();
      showToast('Price entry saved');
      await loadPricesTab();
    } catch (err) {
      handleError(err, 'Failed to save price entry');
    }
  });
}

function initPricesTab() {
  document.getElementById('btn-add-price').addEventListener('click', () => openAddPriceModal(null));

  // Search filtering
  document.getElementById('price-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = pricesState.entries.filter(entry =>
      (entry.itemId?.name || '').toLowerCase().includes(q) ||
      (entry.itemId?.category || '').toLowerCase().includes(q) ||
      (entry.storeId?.name || '').toLowerCase().includes(q)
    );
    renderPricesList(filtered);
  });

  // Detail panel tabs
  document.querySelectorAll('.detail-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.detail-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('detail-' + btn.dataset.detail);
      if (target) target.classList.add('active');
      if (btn.dataset.detail === 'trend') {
        // Redraw trend chart
        const canvas = document.getElementById('trend-chart');
        if (canvas && canvas._datasets) drawLineChart('trend-chart', canvas._datasets);
      }
    });
  });

  // Close detail panel
  document.getElementById('close-detail').addEventListener('click', () => {
    const panel = document.getElementById('item-detail-panel');
    panel.classList.remove('open');
    setTimeout(() => { panel.style.display = 'none'; }, 250);
  });
}
