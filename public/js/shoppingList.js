// Shopping List tab logic

let listState = { items: [] };

async function loadShoppingListTab() {
  try {
    listState.items = await api.shoppingList.list();
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to load shopping list');
  }
}

function renderShoppingList() {
  const items = listState.items;
  renderStoreSummary(items);

  const container = document.getElementById('shopping-list');
  if (!items.length) {
    container.innerHTML = emptyState('📋', 'Your shopping list is empty. Tap "+ Add" to start.');
    return;
  }

  container.innerHTML = items.map(item => {
    const name = item.itemId?.name || 'Unknown item';
    const unit = item.itemId?.unit || '';
    const cat = item.itemId?.category || '';
    const checked = item.checked;

    let priceInfo = '';
    if (item.bestPrice) {
      const { store, pricePerUnit } = item.bestPrice;
      priceInfo = `<div class="card-subtitle text-success">${store?.name} &mdash; ${formatPPU(pricePerUnit, unit)}</div>`;
    } else {
      priceInfo = `<span class="badge badge-no-data">No price data</span>`;
    }

    return `
      <div class="card list-item ${checked ? 'checked' : ''}" data-id="${item._id}">
        <div class="list-item-check ${checked ? 'checked' : ''}"
          onclick="toggleListItem('${item._id}', ${!checked})">
          ${checked ? '✓' : ''}
        </div>
        <div class="card-body">
          <div class="card-title">${name}</div>
          <div class="list-item-meta">${cat}${cat && unit ? ' &middot; ' : ''}qty ${item.quantity}${unit ? ' ' + unit : ''}</div>
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

  container.innerHTML = `
    <h3>Best prices found at:</h3>
    ${lines}${noDataLine}`;
}

async function toggleListItem(id, checked) {
  try {
    await api.shoppingList.update(id, { checked });
    const item = listState.items.find(i => i._id === id);
    if (item) item.checked = checked;
    renderShoppingList();
  } catch (err) {
    handleError(err, 'Failed to update item');
  }
}

async function removeListItem(id) {
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
    onSelect(item) {
      document.getElementById('list-item-id').value = item._id;
    },
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

function initShoppingListTab() {
  document.getElementById('btn-add-list-item').addEventListener('click', openAddListItemModal);

  document.getElementById('btn-clear-checked').addEventListener('click', async () => {
    const count = listState.items.filter(i => i.checked).length;
    if (!count) { showToast('No checked items'); return; }
    if (!confirm(`Remove ${count} checked item${count !== 1 ? 's' : ''}?`)) return;
    try {
      await api.shoppingList.clear(true);
      await loadShoppingListTab();
      showToast('Checked items cleared');
    } catch (err) {
      handleError(err, 'Failed to clear items');
    }
  });

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!listState.items.length) { showToast('List is already empty'); return; }
    if (!confirm('Clear the entire shopping list?')) return;
    try {
      await api.shoppingList.clear(false);
      await loadShoppingListTab();
      showToast('List cleared');
    } catch (err) {
      handleError(err, 'Failed to clear list');
    }
  });
}
