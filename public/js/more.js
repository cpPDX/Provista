// More tab: Inventory, Item Catalog, Stores

// ===== Navigation =====
function showMoreSection(sectionId) {
  document.querySelector('.more-menu').style.display = 'none';
  document.querySelectorAll('.sub-section').forEach(s => s.style.display = 'none');
  document.getElementById('section-' + sectionId).style.display = '';
}

function hideMoreSection() {
  document.querySelector('.more-menu').style.display = '';
  document.querySelectorAll('.sub-section').forEach(s => s.style.display = 'none');
}

// ===== Inventory =====
let inventoryState = { items: [] };

async function loadInventory() {
  try {
    inventoryState.items = await api.inventory.list();
    renderInventory();
  } catch (err) {
    handleError(err, 'Failed to load inventory');
  }
}

function renderInventory() {
  const container = document.getElementById('inventory-list');
  const items = inventoryState.items;
  if (!items.length) {
    container.innerHTML = emptyState('🧺', 'No items in inventory yet.');
    return;
  }
  container.innerHTML = items.map(inv => {
    const name = inv.itemId?.name || 'Unknown';
    const unit = inv.unit || inv.itemId?.unit || '';
    const cat = inv.itemId?.category || '';
    return `
      <div class="card" data-inv-id="${inv._id}">
        <div class="card-body">
          <div class="card-title">${name}</div>
          <div class="card-subtitle">${cat} &middot; Updated ${formatDate(inv.lastUpdated)}</div>
          ${inv.notes ? `<div class="text-muted text-sm">${inv.notes}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.375rem">
          <div class="qty-controls">
            <button class="qty-btn" onclick="adjustInventory('${inv._id}', ${inv.quantity - 1})">−</button>
            <span class="qty-val">${inv.quantity}</span>
            <button class="qty-btn" onclick="adjustInventory('${inv._id}', ${inv.quantity + 1})">+</button>
          </div>
          <span class="text-muted text-sm">${unit}</span>
          <button class="btn btn-danger btn-sm" onclick="removeInventoryItem('${inv._id}')">Remove</button>
        </div>
      </div>`;
  }).join('');
}

async function adjustInventory(id, newQty) {
  if (newQty < 0) newQty = 0;
  try {
    await api.inventory.update(id, { quantity: newQty, lastUpdated: new Date() });
    const item = inventoryState.items.find(i => i._id === id);
    if (item) item.quantity = newQty;
    if (newQty === 0) {
      inventoryState.items = inventoryState.items.filter(i => i._id !== id);
    }
    renderInventory();
  } catch (err) {
    handleError(err, 'Failed to update inventory');
  }
}

async function removeInventoryItem(id) {
  try {
    await api.inventory.delete(id);
    inventoryState.items = inventoryState.items.filter(i => i._id !== id);
    renderInventory();
    showToast('Removed from inventory');
  } catch (err) {
    handleError(err, 'Failed to remove item');
  }
}

function openAddInventoryModal() {
  const bodyHTML = `
    <form id="add-inv-form">
      <div class="form-group">
        <label>Item</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="inv-item-input" placeholder="Search or create item..." autocomplete="off" required />
          <div class="autocomplete-dropdown" id="inv-item-dropdown"></div>
        </div>
        <input type="hidden" id="inv-item-id" />
        <input type="hidden" id="inv-item-unit" />
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input class="form-control" type="number" id="inv-qty" value="1" min="0" step="any" required />
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <input class="form-control" id="inv-notes" placeholder="e.g. expires Friday" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to Inventory</button>
      </div>
    </form>`;

  openModal('Add to Inventory', bodyHTML);

  const itemInput = document.getElementById('inv-item-input');
  const itemDropdown = document.getElementById('inv-item-dropdown');
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) {
      document.getElementById('inv-item-id').value = item._id;
      document.getElementById('inv-item-unit').value = item.unit;
    },
    onCreateNew(name) {
      promptCreateItem(name, (item) => {
        itemInput.value = item.name;
        document.getElementById('inv-item-id').value = item._id;
        document.getElementById('inv-item-unit').value = item.unit;
        openAddInventoryModal();
      });
    }
  });

  document.getElementById('add-inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = document.getElementById('inv-item-id').value;
    if (!itemId) { showToast('Please select an item'); return; }
    const quantity = parseFloat(document.getElementById('inv-qty').value);
    const unit = document.getElementById('inv-item-unit').value;
    const notes = document.getElementById('inv-notes').value.trim();
    try {
      await api.inventory.save({ itemId, quantity, unit, notes });
      closeModal();
      showToast('Added to inventory');
      await loadInventory();
    } catch (err) {
      handleError(err, 'Failed to add to inventory');
    }
  });
}

// ===== Item Catalog =====
let catalogState = { items: [], filtered: [] };

async function loadCatalog() {
  try {
    catalogState.items = await api.items.list();
    catalogState.filtered = catalogState.items;
    renderCatalog();
  } catch (err) {
    handleError(err, 'Failed to load catalog');
  }
}

function renderCatalog() {
  const container = document.getElementById('catalog-list');
  const items = catalogState.filtered;
  if (!items.length) {
    container.innerHTML = emptyState('🏷️', 'No items found.');
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="card">
      <div class="card-body">
        <div class="card-title">${item.name}</div>
        <div class="card-subtitle">${item.category} &middot; ${item.unit}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditItemModal('${item._id}','${escapeAttr(item.name)}','${escapeAttr(item.category)}','${escapeAttr(item.unit)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('${item._id}')">✕</button>
      </div>
    </div>`).join('');
}

function openEditItemModal(id, name, category, unit) {
  const bodyHTML = `
    <form id="edit-item-form">
      <div class="form-group">
        <label>Item Name</label>
        <input class="form-control" name="name" value="${name}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input class="form-control" name="category" value="${category}" required list="category-list2" />
          <datalist id="category-list2">
            <option value="Produce"/><option value="Dairy"/><option value="Meat &amp; Seafood"/>
            <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
            <option value="Beverages"/><option value="Snacks"/>
            <option value="Condiments &amp; Sauces"/><option value="Cleaning &amp; Household"/>
          </datalist>
        </div>
        <div class="form-group">
          <label>Unit</label>
          <input class="form-control" name="unit" value="${unit}" required list="unit-list2" />
          <datalist id="unit-list2">
            <option value="lb"/><option value="oz"/><option value="each"/>
            <option value="fl oz"/><option value="gal"/><option value="dozen"/>
            <option value="pack"/><option value="count"/><option value="loaf"/>
          </datalist>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>`;

  openModal('Edit Item', bodyHTML);

  document.getElementById('edit-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.items.update(id, {
        name: form.name.value.trim(),
        category: form.category.value.trim(),
        unit: form.unit.value.trim()
      });
      closeModal();
      showToast('Item updated');
      await loadCatalog();
    } catch (err) {
      handleError(err, 'Failed to update item');
    }
  });
}

async function deleteItem(id) {
  if (!confirm('Delete this item? This will not delete price history.')) return;
  try {
    await api.items.delete(id);
    showToast('Item deleted');
    await loadCatalog();
  } catch (err) {
    handleError(err, 'Failed to delete item');
  }
}

function openAddCatalogItemModal() {
  promptCreateItem('', async (item) => {
    await loadCatalog();
    showToast('Item created');
  });
}

// ===== Stores =====
let storesState = { stores: [] };

async function loadStores() {
  try {
    storesState.stores = await api.stores.list();
    renderStores();
  } catch (err) {
    handleError(err, 'Failed to load stores');
  }
}

function renderStores() {
  const container = document.getElementById('stores-list');
  if (!storesState.stores.length) {
    container.innerHTML = emptyState('🏪', 'No stores yet. Add one!');
    return;
  }
  container.innerHTML = storesState.stores.map(store => `
    <div class="card">
      <div class="card-body">
        <div class="card-title">${store.name}</div>
        ${store.location ? `<div class="card-subtitle">${store.location}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm" onclick="openEditStoreModal('${store._id}','${escapeAttr(store.name)}','${escapeAttr(store.location || '')}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStore('${store._id}')">✕</button>
      </div>
    </div>`).join('');
}

function openEditStoreModal(id, name, location) {
  const bodyHTML = `
    <form id="edit-store-form">
      <div class="form-group">
        <label>Store Name</label>
        <input class="form-control" name="name" value="${name}" required />
      </div>
      <div class="form-group">
        <label>Location (optional)</label>
        <input class="form-control" name="location" value="${location}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>`;

  openModal('Edit Store', bodyHTML);

  document.getElementById('edit-store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.stores.update(id, {
        name: form.name.value.trim(),
        location: form.location.value.trim()
      });
      closeModal();
      showToast('Store updated');
      await loadStores();
    } catch (err) {
      handleError(err, 'Failed to update store');
    }
  });
}

async function deleteStore(id) {
  if (!confirm('Delete this store?')) return;
  try {
    await api.stores.delete(id);
    showToast('Store deleted');
    await loadStores();
  } catch (err) {
    handleError(err, 'Failed to delete store');
  }
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function initMoreTab() {
  // More menu item navigation
  document.querySelectorAll('.more-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      showMoreSection(section);
      if (section === 'inventory') await loadInventory();
      else if (section === 'items') await loadCatalog();
      else if (section === 'stores') await loadStores();
    });
  });

  // Back buttons
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', hideMoreSection);
  });

  // Add buttons
  document.getElementById('btn-add-inventory').addEventListener('click', openAddInventoryModal);
  document.getElementById('btn-add-item-catalog').addEventListener('click', openAddCatalogItemModal);
  document.getElementById('btn-add-store').addEventListener('click', () => {
    promptCreateStore('', async (store) => {
      await loadStores();
      showToast('Store added');
    });
  });

  // Catalog search
  document.getElementById('catalog-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    catalogState.filtered = catalogState.items.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
    renderCatalog();
  });
}
