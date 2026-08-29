// More tab: Insights, Product Catalog, Stores, Household, Account

// ===== Navigation =====
function showMoreSection(sectionId) {
  document.querySelector('#tab-more .page-header')?.style.setProperty('display', 'none');
  document.querySelector('.more-menu').style.display = 'none';
  document.querySelectorAll('.sub-section').forEach(s => s.style.display = 'none');
  const el = document.getElementById('section-' + sectionId);
  if (el) el.style.display = '';
}

function hideMoreSection() {
  document.querySelector('#tab-more .page-header')?.style.removeProperty('display');
  document.querySelector('.more-menu').style.display = '';
  document.querySelectorAll('.sub-section').forEach(s => s.style.display = 'none');
}

// ===== Account Settings (all roles) =====
async function loadAccountSettings() {
  const container = document.getElementById('account-content');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  const auth = window.appAuth;
  const user = auth.user;

  const ownerWarning = auth.isOwner()
    ? `<p class="text-sm" style="color:var(--warning);margin-bottom:0.5rem">You are a household owner. Delete your household first before deleting your account.</p>`
    : '';

  container.innerHTML = `
    <h3 style="margin:0 0 0.75rem;font-size:1rem">Profile</h3>
    <form id="profile-form" style="margin-bottom:1.5rem">
      <div class="form-group">
        <label>Name</label>
        <input class="form-control" id="profile-name" value="${escapeAttr(user.name)}" required />
      </div>
      <div class="form-group">
        <label>Email</label>
        <input class="form-control" type="email" id="profile-email" value="${escapeAttr(user.email)}" required />
      </div>
      <button type="submit" class="btn btn-primary btn-full">Save Profile</button>
    </form>

    ${auth.features?.barcodeScanning ? `
    <h3 style="margin:0 0 0.75rem;font-size:1rem">Barcode Scanning</h3>
    <div style="margin-bottom:1.5rem">
      <div class="filter-toggle-row">
        <span>Auto-accept barcode matches for me</span>
        <select id="barcode-accept-pref" class="form-control" style="width:auto">
          <option value="inherit">Inherit from household</option>
          <option value="true">Always auto-accept</option>
          <option value="false">Always confirm</option>
        </select>
      </div>
      <p class="text-muted text-sm" style="margin-top:0.5rem">Override the household barcode setting for your scans only.</p>
    </div>` : ''}

    <h3 style="margin:0 0 0.75rem;font-size:1rem">Change Password</h3>
    <form id="password-form" style="margin-bottom:1.5rem">
      <div class="form-group">
        <label>Current Password</label>
        <input class="form-control" type="password" id="pw-current" required autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label>New Password</label>
        <input class="form-control" type="password" id="pw-new" required autocomplete="new-password" minlength="8" />
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input class="form-control" type="password" id="pw-confirm" required autocomplete="new-password" />
      </div>
      <button type="submit" class="btn btn-primary btn-full">Change Password</button>
    </form>

    <div class="danger-zone">
      <h3>Danger Zone</h3>
      ${ownerWarning}
      <p>Deleting your account is permanent and cannot be undone. All your personal data will be removed.</p>
      <button class="btn btn-danger btn-full" id="btn-delete-account"${auth.isOwner() ? ' disabled title="Delete your household first"' : ''}>Delete My Account</button>
    </div>`;

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    try {
      const { user: updated } = await api.auth.updateProfile({ name, email });
      auth.user.name = updated.name;
      auth.user.email = updated.email;
      document.getElementById('user-label').textContent = updated.name;
      showToast('Profile updated');
    } catch (err) {
      handleError(err, 'Failed to update profile');
    }
  });

  // Barcode preference selector
  const barcodePrefSel = document.getElementById('barcode-accept-pref');
  if (barcodePrefSel) {
    const current = user.preferences?.barcodeAutoAccept;
    barcodePrefSel.value = current === null || current === undefined ? 'inherit' : String(current);
    barcodePrefSel.addEventListener('change', async () => {
      const val = barcodePrefSel.value;
      const barcodeAutoAccept = val === 'inherit' ? null : val === 'true';
      try {
        await api.auth.updateProfile({ barcodeAutoAccept });
        if (auth.user.preferences) auth.user.preferences.barcodeAutoAccept = barcodeAutoAccept;
        showToast('Preference saved');
      } catch (err) {
        handleError(err, 'Failed to save preference');
      }
    });
  }

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPw = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;
    if (newPw !== confirm) { showToast('Passwords do not match'); return; }
    try {
      await api.auth.changePassword({
        currentPassword: document.getElementById('pw-current').value,
        newPassword: newPw
      });
      document.getElementById('password-form').reset();
      showToast('Password changed');
    } catch (err) {
      handleError(err, 'Failed to change password');
    }
  });

  const deleteAccountBtn = document.getElementById('btn-delete-account');
  if (deleteAccountBtn && !auth.isOwner()) {
    deleteAccountBtn.addEventListener('click', () => {
      openModal('Delete Account', `
        <p style="margin-bottom:1rem">This will permanently delete your account and remove all your personal data. This cannot be undone.</p>
        <form id="delete-account-form">
          <div class="form-group">
            <label>Enter your password to confirm</label>
            <input class="form-control" type="password" id="da-password" required autocomplete="current-password" />
          </div>
          <div class="checkbox-row" style="margin-bottom:1rem">
            <input type="checkbox" id="da-confirm" required />
            <label for="da-confirm">I understand this is permanent and cannot be undone</label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn btn-danger">Delete Account</button>
          </div>
        </form>`);

      document.getElementById('delete-account-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!document.getElementById('da-confirm').checked) {
          showToast('Please check the confirmation box');
          return;
        }
        const btn = formSubmitButton(e.target);
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          await api.auth.deleteAccount({ password: document.getElementById('da-password').value });
          window.location.href = '/';
        } catch (err) {
          handleError(err, 'Failed to delete account');
          btn.disabled = false;
          btn.textContent = 'Delete Account';
        }
      });
    });
  }
}

// ===== Pantry (routine changes are available to every household member) =====
let inventoryState = { items: [], search: '' };

async function loadInventory() {
  try {
    inventoryState.items = await api.inventory.list();
    renderInventory();
  } catch (err) {
    handleError(err, 'Failed to load pantry');
  }
}

function renderInventory() {
  const container = document.getElementById('inventory-list');
  const query = inventoryState.search.trim().toLowerCase();
  const priority = { out: 0, low: 1, have: 2 };
  const items = inventoryState.items
    .filter(inv => {
      if (!query) return true;
      return [inv.itemId?.name, inv.itemId?.brand, inv.itemId?.category, inv.notes]
        .some(value => String(value || '').toLowerCase().includes(query));
    })
    .sort((a, b) => (priority[a.stockStatus] ?? 3) - (priority[b.stockStatus] ?? 3) ||
      new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
  if (!items.length) {
    container.innerHTML = emptyState('🧺', query ? 'No Pantry items match that search.' : 'No Pantry items yet.');
    return;
  }
  container.innerHTML = items.map(inv => {
    const name = escapeHtml(inv.itemId?.name || 'Unknown');
    const unit = escapeHtml(inv.unit || inv.itemId?.unit || '');
    const cat = escapeHtml(inv.itemId?.category || '');
    const status = inv.stockStatus || (inv.quantity <= 0 ? 'out' : 'have');
    const statusLabel = { have: 'Have', low: 'Running low', out: 'Out' }[status];
    return `
      <div class="card pantry-card pantry-${status}" data-inv-id="${inv._id}">
        <div class="card-body">
          <div class="card-title">${name}${inv.itemId?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(inv.itemId.brand) + ')</span>' : ''} <span class="badge pantry-status-badge">${statusLabel}</span></div>
          <div class="card-subtitle">${inv.itemId ? formatItemMeta(inv.itemId) : cat} &middot; Updated ${formatDate(inv.lastUpdated)}</div>
          ${inv.notes ? `<div class="text-muted text-sm">${escapeHtml(inv.notes)}</div>` : ''}
          <div class="pantry-status-actions" role="group" aria-label="Stock status for ${escapeAttr(inv.itemId?.name || 'item')}">
            ${['have', 'low', 'out'].map(value => `
              <button type="button" class="pantry-status-option${status === value ? ' active' : ''}"
                data-stock-status="${value}" onclick="setInventoryStatus('${inv._id}', '${value}')" aria-pressed="${status === value}">
                ${{ have: 'Have', low: 'Running low', out: 'Out' }[value]}
              </button>`).join('')}
          </div>
          <details class="pantry-exact-quantity">
            <summary>Exact quantity: ${inv.quantity}${unit ? ` ${unit}` : ''}</summary>
            <div class="qty-controls">
              <button type="button" class="qty-btn" onclick="adjustInventory('${inv._id}', ${inv.quantity - 1})" aria-label="Decrease ${escapeAttr(inv.itemId?.name || 'item')} quantity">−</button>
              <span class="qty-val" aria-live="polite">${inv.quantity}</span>
              <button type="button" class="qty-btn" onclick="adjustInventory('${inv._id}', ${inv.quantity + 1})" aria-label="Increase ${escapeAttr(inv.itemId?.name || 'item')} quantity">+</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="openEditInventoryModal('${inv._id}')">Edit details</button>
              ${window.appAuth?.isAdmin() ? `<button type="button" class="btn btn-danger btn-sm" onclick="removeInventoryItem('${inv._id}')">Remove</button>` : ''}
            </div>
          </details>
        </div>
      </div>`;
  }).join('');
}

async function setInventoryStatus(id, stockStatus) {
  const item = inventoryState.items.find(entry => entry._id === id);
  if (!item || item.stockStatus === stockStatus) return;
  const previous = { stockStatus: item.stockStatus, quantity: item.quantity };
  item.stockStatus = stockStatus;
  if (stockStatus === 'out') item.quantity = 0;
  else if (item.quantity <= 0) item.quantity = 1;
  renderInventory();
  document.querySelector(`[data-inv-id="${CSS.escape(id)}"] .pantry-status-option[data-stock-status="${stockStatus}"]`)?.focus({ preventScroll: true });
  try {
    const updated = await api.inventory.update(id, { stockStatus });
    Object.assign(item, updated);
    renderInventory();
    showToast(`${item.itemId?.name || 'Item'} marked ${stockStatus === 'low' ? 'running low' : stockStatus}`);
  } catch (err) {
    Object.assign(item, previous);
    renderInventory();
    handleError(err, 'Failed to update Pantry status');
  }
}

async function adjustInventory(id, newQty) {
  if (newQty < 0) newQty = 0;
  const item = inventoryState.items.find(entry => entry._id === id);
  if (!item) return;
  const previous = { quantity: item.quantity, stockStatus: item.stockStatus };
  item.quantity = newQty;
  item.stockStatus = newQty <= 0 ? 'out' : 'have';
  renderInventory();
  try {
    const updated = await api.inventory.update(id, { quantity: newQty });
    Object.assign(item, updated);
    const unit = item.unit || item.itemId?.unit || '';
    showToast(`Updated to ${newQty}${unit ? ' ' + unit : ''}`);
    renderInventory();
  } catch (err) {
    Object.assign(item, previous);
    renderInventory();
    handleError(err, 'Failed to update Pantry');
  }
}

async function removeInventoryItem(id) {
  const item = inventoryState.items.find(entry => entry._id === id);
  if (!confirm(`Remove ${item?.itemId?.name || 'this item'} from Pantry tracking?`)) return;
  try {
    await api.inventory.delete(id);
    inventoryState.items = inventoryState.items.filter(i => i._id !== id);
    renderInventory();
    showToast('Removed from Pantry');
  } catch (err) {
    handleError(err, 'Failed to remove item');
  }
}

function openAddInventoryModal() {
  const bodyHTML = `
    <form id="add-inv-form">
      <div class="form-group">
        <label for="inv-item-input">Item</label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="inv-item-input" placeholder="Search or create item…" autocomplete="off" required />
          <div class="autocomplete-dropdown" id="inv-item-dropdown"></div>
        </div>
        <input type="hidden" id="inv-item-id" />
        <input type="hidden" id="inv-item-unit" />
      </div>
      ${inlineItemCreationFields('inv')}
      <div class="form-group">
        <label for="inv-status">Pantry status</label>
        <select class="form-control" id="inv-status">
          <option value="have">Have</option>
          <option value="low">Running low</option>
          <option value="out">Out</option>
        </select>
      </div>
      <div class="form-group">
        <label for="inv-notes">Notes (optional)</label>
        <input class="form-control" id="inv-notes" placeholder="e.g. expires Friday" />
      </div>
      <details class="pantry-advanced-fields">
        <summary>Track an exact quantity (optional)</summary>
        <div class="form-group">
          <label for="inv-qty">Quantity</label>
          <input class="form-control" type="number" id="inv-qty" value="1" min="0" step="any" />
        </div>
        <div class="form-group">
          <label for="inv-threshold">Quantity alert (optional)</label>
          <input class="form-control" type="number" id="inv-threshold" placeholder="Alert at or below…" min="0" step="any" />
        </div>
      </details>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add to Pantry</button>
      </div>
    </form>`;
  openModal('Add to Pantry', bodyHTML);

  const itemInput = document.getElementById('inv-item-input');
  let selectedItemName = '';
  attachItemAutocomplete(itemInput, document.getElementById('inv-item-dropdown'), {
    onSelect(item) {
      selectedItemName = item.name;
      document.getElementById('inv-item-id').value = item._id;
      document.getElementById('inv-item-unit').value = item.unit;
      clearInlineItemCreation('inv');
    },
    onCreateNew: name => {
      selectedItemName = '';
      startInlineItemCreation('inv', name, 'inv-item-input', 'inv-item-id');
    }
  });
  itemInput.addEventListener('input', () => {
    if (document.getElementById('inv-new-item-mode')?.value === 'true') return;
    if (selectedItemName && itemInput.value !== selectedItemName) document.getElementById('inv-item-id').value = '';
  });

  document.getElementById('add-inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let itemId = document.getElementById('inv-item-id').value;
    const thresholdRaw = document.getElementById('inv-threshold').value.trim();
    const lowStockThreshold = thresholdRaw !== '' ? parseFloat(thresholdRaw) : null;
    const submit = formSubmitButton(e.target);
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      if (!itemId) {
        const newItem = readInlineItemCreation('inv', itemInput.value);
        if (!newItem) throw new Error('Select an item or choose Create');
        const created = await api.items.create(newItem);
        itemId = created._id;
        document.getElementById('inv-item-unit').value = created.unit || '';
      }
      await api.inventory.save({
        itemId,
        quantity: parseFloat(document.getElementById('inv-qty').value),
        stockStatus: document.getElementById('inv-status').value,
        unit: document.getElementById('inv-item-unit').value,
        notes: document.getElementById('inv-notes').value.trim(),
        lowStockThreshold
      });
      closeModal();
      showToast('Added to Pantry');
      await loadInventory();
    } catch (err) {
      handleError(err, 'Failed to add to Pantry');
      submit.disabled = false;
      submit.textContent = 'Add to Pantry';
    }
  });
}

function openEditInventoryModal(id) {
  const inv = inventoryState.items.find(i => i._id === id);
  if (!inv) return;
  const bodyHTML = `
    <form id="edit-inv-form">
      <div class="form-group">
        <label for="edit-inv-status">Pantry status</label>
        <select class="form-control" id="edit-inv-status">
          <option value="have"${inv.stockStatus === 'have' ? ' selected' : ''}>Have</option>
          <option value="low"${inv.stockStatus === 'low' ? ' selected' : ''}>Running low</option>
          <option value="out"${inv.stockStatus === 'out' ? ' selected' : ''}>Out</option>
        </select>
      </div>
      <div class="form-group">
        <label for="edit-inv-notes">Notes (optional)</label>
        <input class="form-control" id="edit-inv-notes" value="${escapeAttr(inv.notes || '')}" placeholder="e.g. expires Friday" />
      </div>
      <details class="pantry-advanced-fields">
        <summary>Exact quantity and alert</summary>
        <div class="form-group">
          <label for="edit-inv-qty">Quantity</label>
          <input class="form-control" type="number" id="edit-inv-qty" value="${inv.quantity}" min="0" step="any" required />
        </div>
        <div class="form-group">
          <label for="edit-inv-threshold">Quantity alert (optional)</label>
          <input class="form-control" type="number" id="edit-inv-threshold" value="${escapeAttr(inv.lowStockThreshold ?? '')}" placeholder="Alert at or below…" min="0" step="any" />
        </div>
      </details>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  openModal('Edit Pantry Item', bodyHTML);
  registerDirtyForm(() => document.getElementById('edit-inv-form')?.requestSubmit());
  document.getElementById('edit-inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const thresholdRaw = document.getElementById('edit-inv-threshold').value.trim();
    const lowStockThreshold = thresholdRaw !== '' ? parseFloat(thresholdRaw) : null;
    try {
      await api.inventory.update(id, {
        quantity: parseFloat(document.getElementById('edit-inv-qty').value),
        stockStatus: document.getElementById('edit-inv-status').value,
        notes: document.getElementById('edit-inv-notes').value.trim(),
        lowStockThreshold
      });
      closeModal();
      showToast('Pantry updated');
      await loadInventory();
    } catch (err) {
      handleError(err, 'Failed to update Pantry');
    }
  });
}

// ===== Product Catalog (admin+) =====
let catalogState = { items: [], filtered: [] };
let catalogFilterState = { categories: [], organic: 'all', sortBy: 'name' };

async function loadCatalog() {
  try {
    catalogState.items = await api.items.list();
    applyCatalogFilter();
    updateCatalogBackBanner();
    if (window.appAuth?.isAdmin()) updateDuplicateBanner();
  } catch (err) {
    handleError(err, 'Failed to load catalog');
  }
}

async function updateDuplicateBanner() {
  const banner = document.getElementById('catalog-dupe-banner');
  if (!banner) return;
  try {
    const clusters = await api.admin.duplicateGroups();
    if (!clusters.length) { banner.style.display = 'none'; return; }
    const total = clusters.reduce((s, c) => s + c.duplicates.length, 0);
    const names = clusters.map(c => `"${c.canonical.name}"`).join(', ');
    banner.innerHTML = `⚠️ ${total} duplicate item${total !== 1 ? 's' : ''} found (${names}).
      <button class="btn-link" id="btn-consolidate" style="margin-left:0.5rem">Consolidate Now →</button>`;
    banner.style.display = '';
    document.getElementById('btn-consolidate').onclick = async () => {
      document.getElementById('btn-consolidate').textContent = 'Consolidating…';
      try {
        const result = await api.admin.consolidate();
        const summary = result.merged.map(m => `"${m.into}" ← ${m.absorbed.join(', ')}`).join('; ');
        showToast(`Consolidated ${result.totalRemoved} duplicate item${result.totalRemoved !== 1 ? 's' : ''}: ${summary}`, 5000);
        banner.style.display = 'none';
        await loadCatalog();
      } catch (err) { handleError(err, 'Consolidation failed'); }
    };
  } catch (_) {
    banner.style.display = 'none';
  }
}

function applyCatalogFilter() {
  const { categories, organic, sortBy } = catalogFilterState;
  const q = (document.getElementById('catalog-search')?.value || '').toLowerCase();

  let items = catalogState.items.filter(item => {
    if (q && !(item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q) || (item.brand || '').toLowerCase().includes(q))) return false;
    if (categories.length && !categories.includes(item.category)) return false;
    if (organic === 'organic' && !item.isOrganic) return false;
    if (organic === 'conventional' && item.isOrganic) return false;
    return true;
  });

  if (sortBy === 'name') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === 'lastPurchased') {
    const lastPurchased = {};
    (window.pricesState?.entries || []).forEach(e => {
      const id = String(e.itemId?._id || e.itemId);
      if (!lastPurchased[id] || new Date(e.date) > new Date(lastPurchased[id]))
        lastPurchased[id] = e.date;
    });
    items.sort((a, b) => {
      const da = lastPurchased[String(a._id)], db = lastPurchased[String(b._id)];
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return new Date(db) - new Date(da);
    });
  }

  catalogState.filtered = items;
  renderCatalog();

  const isFiltered = categories.length || organic !== 'all';
  const countBar = document.getElementById('catalog-filter-count');
  if (countBar) {
    countBar.textContent = isFiltered ? `Showing ${items.length} of ${catalogState.items.length} products` : '';
    countBar.style.display = isFiltered ? '' : 'none';
  }
  const dot = document.getElementById('catalog-filter-dot');
  if (dot) dot.style.display = (isFiltered || sortBy !== 'name') ? '' : 'none';
}

function updateCatalogBackBanner() {
  const banner = document.getElementById('catalog-back-banner');
  const btn = document.getElementById('btn-catalog-back');
  if (!banner || !btn) return;
  if (window._catalogBackNav) {
    btn.textContent = `← Back to ${window._catalogBackNav.itemName} Price`;
    banner.style.display = '';
    btn.onclick = () => {
      const { itemId, itemName } = window._catalogBackNav;
      window._catalogBackNav = null;
      banner.style.display = 'none';
      hideMoreSection();
      switchTab('prices');
      openItemDetail(itemId, itemName);
    };
  } else {
    banner.style.display = 'none';
  }
}

function openCatalogFilterSheet() {
  const cats = [...new Set(catalogState.items.map(i => i.category).filter(Boolean))].sort();
  const f = catalogFilterState;

  document.getElementById('filter-sheet-title').textContent = 'Filter & Sort';
  document.getElementById('filter-sheet-body').innerHTML = `
    <div>
      <div class="filter-section-label">Sort by</div>
      <div class="filter-chips">
        ${[['name','Name A→Z'],['lastPurchased','Last purchased']].map(([v,l]) =>
          `<button class="filter-chip${f.sortBy===v?' selected':''}" onclick="setCatalogFilterSort(this,'${v}')">${l}</button>`).join('')}
      </div>
    </div>
    ${cats.length ? `<div>
      <div class="filter-section-label">Category</div>
      <div class="filter-chips">
        ${cats.map(c => `<button class="filter-chip${f.categories.includes(c)?' selected':''}" data-cat="${escapeAttr(c)}" onclick="toggleCatalogFilterCat(this)">${escapeHtml(c)}</button>`).join('')}
      </div>
    </div>` : ''}
    <div>
      <div class="filter-section-label">Organic</div>
      <div class="filter-chips">
        ${[['all','All'],['organic','Organic only'],['conventional','Conventional only']].map(([v,l]) =>
          `<button class="filter-chip${f.organic===v?' selected':''}" onclick="setCatalogFilterOrganic(this,'${v}')">${l}</button>`).join('')}
      </div>
    </div>`;

  document.getElementById('filter-sheet-clear').onclick = () => {
    catalogFilterState = { categories: [], organic: 'all', sortBy: 'name' };
    closeFilterSheet();
    applyCatalogFilter();
  };
  document.getElementById('filter-sheet-done').onclick = () => { closeFilterSheet(); applyCatalogFilter(); };
  const overlay = document.getElementById('filter-sheet-overlay');
  const closeAndApply = () => { closeFilterSheet(); applyCatalogFilter(); };
  activateDialogSurface(overlay, document.getElementById('filter-sheet'), document.getElementById('filter-sheet-done'), closeAndApply);
  overlay.onclick = (e) => {
    if (e.target === overlay) closeAndApply();
  };
}

function toggleCatalogFilterCat(btn) {
  const cat = btn.dataset.cat;
  const f = catalogFilterState;
  if (f.categories.includes(cat)) { f.categories = f.categories.filter(c => c !== cat); btn.classList.remove('selected'); }
  else { f.categories.push(cat); btn.classList.add('selected'); }
}
function setCatalogFilterSort(btn, val) {
  catalogFilterState.sortBy = val;
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}
function setCatalogFilterOrganic(btn, val) {
  catalogFilterState.organic = val;
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function renderCatalog() {
  const container = document.getElementById('catalog-list');
  const items = catalogState.filtered;
  if (!items.length) {
    container.innerHTML = emptyState('🏷️', 'No items found.');
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="card swipeable" data-item-id="${item._id}">
      <button type="button" class="card-body-wrap" aria-label="Edit ${escapeAttr(item.name)}">
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.name)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}</div>
          <div class="card-subtitle">${formatItemMeta(item)}</div>
        </div>
      </button>
      <button type="button" class="card-swipe-delete" aria-label="Delete ${escapeAttr(item.name)}">Delete</button>
    </div>`).join('');

  // Tap to edit, swipe left to delete
  container.querySelectorAll('.card.swipeable').forEach(card => {
    const id = card.dataset.itemId;
    const item = items.find(i => i._id === id);
    if (!item) return;
    card.querySelector('.card-body-wrap').addEventListener('click', () => {
      openEditItemModal(id, item.name, item.category, item.unit, !!item.isOrganic, item.brand || '', item.size);
    });
    card.querySelector('.card-swipe-delete').addEventListener('click', () => deleteItem(id));
    attachSwipeDelete(card);
  });
}

function openEditItemModal(id, name, category, unit, isOrganic = false, brand = '', size = null) {
  const bodyHTML = `
    <form id="edit-item-form">
      <div class="form-group">
        <label>Item Name</label>
        <input class="form-control" name="name" value="${escapeAttr(name)}" required />
      </div>
      <div class="form-group">
        <label>Brand <span class="text-muted text-sm">(optional)</span></label>
        <input class="form-control" name="brand" value="${escapeAttr(brand)}" placeholder="e.g. Great Value, Kirkland" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input class="form-control" name="category" value="${escapeAttr(category)}" required list="cat-dl" />
          <datalist id="cat-dl">
            <option value="Produce"/><option value="Dairy"/><option value="Meat &amp; Seafood"/>
            <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
            <option value="Beverages"/><option value="Snacks"/>
            <option value="Condiments &amp; Sauces"/><option value="Cleaning &amp; Household"/>
          </datalist>
        </div>
        <div class="form-group">
          <label>Unit</label>
          <input class="form-control" name="unit" value="${escapeAttr(unit)}" required list="unit-dl" />
          <datalist id="unit-dl">
            <option value="lb"/><option value="oz"/><option value="each"/>
            <option value="fl oz"/><option value="gal"/><option value="dozen"/>
            <option value="pack"/><option value="count"/><option value="loaf"/>
          </datalist>
        </div>
      </div>
      <div class="form-group">
        <label>Size <span class="text-muted text-sm">(optional)</span></label>
        <input class="form-control" type="number" name="size" step="any" min="0" value="${size != null ? size : ''}" placeholder="e.g. 28 (for 28 oz)" />
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:0.5rem">
        <input type="checkbox" name="isOrganic" id="edit-item-organic" ${isOrganic ? 'checked' : ''} />
        <label for="edit-item-organic" style="margin:0;font-weight:500">Organic product</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
    <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
      <p class="text-muted text-sm" style="margin-bottom:0.5rem">Duplicate item? Merge all price history into another item and delete this one.</p>
      <div class="autocomplete-wrap">
        <input class="form-control" id="merge-target-input" placeholder="Search for item to merge into…" autocomplete="off" />
        <div class="autocomplete-dropdown" id="merge-target-dropdown"></div>
      </div>
      <input type="hidden" id="merge-target-id" />
      <button type="button" class="btn btn-danger btn-sm" id="btn-do-merge" style="margin-top:0.5rem;display:none">Merge into selected item →</button>
      <p id="merge-error" class="text-danger" style="display:none;margin-top:0.5rem;font-size:var(--text-sm)"></p>
    </div>`;

  openModal('Edit Item', bodyHTML);

  document.getElementById('edit-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      const sizeVal = parseFloat(form.size.value);
      await api.items.update(id, {
        name: form.name.value.trim(),
        brand: form.brand.value.trim(),
        category: form.category.value.trim(),
        unit: form.unit.value.trim(),
        size: !isNaN(sizeVal) && sizeVal > 0 ? sizeVal : null,
        isOrganic: form.isOrganic.checked
      });
      closeModal();
      showToast('Item updated');
      await loadCatalog();
    } catch (err) { handleError(err, 'Failed to update item'); }
  });

  // Merge autocomplete
  const mergeInput = document.getElementById('merge-target-input');
  const mergeDropdown = document.getElementById('merge-target-dropdown');
  const mergeBtn = document.getElementById('btn-do-merge');
  attachItemAutocomplete(mergeInput, mergeDropdown, {
    onSelect(target) {
      document.getElementById('merge-target-id').value = target._id;
      mergeBtn.textContent = `Merge into "${target.name}" →`;
      mergeBtn.style.display = '';
    }
  });

  mergeBtn.addEventListener('click', async () => {
    const targetId = document.getElementById('merge-target-id').value;
    const targetName = mergeInput.value;
    const errEl = document.getElementById('merge-error');
    if (errEl) errEl.style.display = 'none';
    if (!targetId) return;
    if (targetId === id) {
      if (errEl) { errEl.textContent = 'Cannot merge an item into itself.'; errEl.style.display = ''; }
      return;
    }
    if (!confirm(`Merge "${name}" into "${targetName}"?\n\nAll price history, shopping list entries, and Pantry entries will move to "${targetName}". This item will be deleted.`)) return;
    mergeBtn.disabled = true;
    mergeBtn.textContent = 'Merging…';
    try {
      await api.items.merge(id, targetId);
      closeModal();
      showToast(`Merged "${name}" into "${targetName}"`);
      await loadCatalog();
    } catch (err) {
      const msg = err?.message || 'Merge failed';
      if (errEl) { errEl.textContent = `Error: ${msg}`; errEl.style.display = ''; }
      handleError(err, 'Merge failed');
      mergeBtn.disabled = false;
      mergeBtn.textContent = `Merge into "${targetName}" →`;
    }
  });
}

async function deleteItem(id) {
  if (!confirm('Delete this item? Price history will remain.')) return;
  try {
    await api.items.delete(id);
    showToast('Item deleted');
    await loadCatalog();
  } catch (err) { handleError(err, 'Failed to delete item'); }
}

// ===== Stores (admin+) =====
let storesState = { stores: [] };

async function loadStores() {
  try {
    storesState.stores = await api.stores.list();
    renderStores();
  } catch (err) { handleError(err, 'Failed to load stores'); }
}

function renderStores() {
  const container = document.getElementById('stores-list');
  if (!storesState.stores.length) {
    container.innerHTML = emptyState('🏪', 'No stores yet. Add one!');
    return;
  }
  container.innerHTML = storesState.stores.map(store => `
    <div class="card swipeable" data-store-id="${store._id}">
      <button type="button" class="card-body-wrap" aria-label="Edit ${escapeAttr(store.name)}">
        <div class="card-body">
          <div class="card-title">${escapeHtml(store.name)}</div>
          ${store.location ? `<div class="card-subtitle">${escapeHtml(store.location)}</div>` : ''}
        </div>
      </button>
      <button type="button" class="card-swipe-delete" aria-label="Delete ${escapeAttr(store.name)}">Delete</button>
    </div>`).join('');

  // Tap to edit, swipe left to delete
  container.querySelectorAll('.card.swipeable').forEach(card => {
    const id = card.dataset.storeId;
    const store = storesState.stores.find(s => s._id === id);
    if (!store) return;
    card.querySelector('.card-body-wrap').addEventListener('click', () => {
      openEditStoreModal(id, store.name, store.location || '');
    });
    card.querySelector('.card-swipe-delete').addEventListener('click', () => deleteStore(id));
    attachSwipeDelete(card);
  });
}

function openEditStoreModal(id, name, location) {
  const bodyHTML = `
    <form id="edit-store-form">
      <div class="form-group">
        <label>Store Name</label>
        <input class="form-control" name="name" value="${escapeAttr(name)}" required />
      </div>
      <div class="form-group">
        <label>Location (optional)</label>
        <input class="form-control" name="location" value="${escapeAttr(location)}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  openModal('Edit Store', bodyHTML);
  document.getElementById('edit-store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.stores.update(id, { name: form.name.value.trim(), location: form.location.value.trim() });
      closeModal();
      showToast('Store updated');
      await loadStores();
    } catch (err) { handleError(err, 'Failed to update store'); }
  });
}

async function deleteStore(id) {
  if (!confirm('Delete this store?')) return;
  try {
    await api.stores.delete(id);
    showToast('Store deleted');
    await loadStores();
  } catch (err) { handleError(err, 'Failed to delete store'); }
}

// ===== Household Section (all roles) =====
async function loadHousehold() {
  const container = document.getElementById('household-content');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const [{ household, members }, stores] = await Promise.all([
      api.household.get(),
      api.stores.list()
    ]);
    const auth = window.appAuth;

    let html = `
      <div class="card" style="margin-bottom:0.75rem">
        <div class="card-body">
          <div class="card-title">${escapeHtml(household.name)}</div>
          <div class="card-subtitle">Household</div>
        </div>
        ${auth.isOwner() ? `<button class="btn btn-outline btn-sm" onclick="openRenameHouseholdModal('${escapeAttr(household.name)}')">Rename</button>` : ''}
      </div>
      <h2 class="section-title" style="padding-left:0">Members (${members.length})</h2>
      <div id="members-list">
        ${members.map(m => renderMemberCard(m, auth, household)).join('')}
      </div>`;

    // Invite code section (admin+)
    if (auth.isAdmin()) {
      html += `
        <h2 class="section-title" style="padding-left:0;margin-top:0.5rem">Invite Code</h2>
        <div id="invite-section">
          <button class="btn btn-outline btn-full" id="btn-show-invite">Show Invite Code &amp; QR</button>
        </div>`;
    }

    // Barcode scanning settings (admin+, only if feature enabled)
    if (auth.isAdmin() && auth.features?.barcodeScanning) {
      const autoAcceptChecked = household.settings?.barcodeAutoAccept ? ' checked' : '';
      html += `
        <h2 class="section-title" style="padding-left:0;margin-top:0.5rem">Barcode Scanning</h2>
        <label class="filter-toggle-row" for="household-barcode-autaccept" style="margin-bottom:0.5rem;cursor:pointer">
          <span>Auto-accept barcode matches for new items</span>
          <input type="checkbox" id="household-barcode-autaccept"${autoAcceptChecked} />
        </label>
        <p class="text-muted text-sm">When enabled, confident barcode matches are saved automatically without requiring review.</p>`;
    }

    const usualStoreId = String(household.settings?.usualStoreId || '');
    const usualStore = stores.find(store => String(store._id) === usualStoreId);
    if (auth.isAdmin()) {
      html += `
        <h2 class="section-title" style="padding-left:0;margin-top:0.5rem">Shopping defaults</h2>
        <form id="household-shopping-settings" class="household-settings-card">
          <div class="form-group">
            <label for="household-usual-store">Usual store</label>
            <select class="form-control" id="household-usual-store">
              <option value="">Infer from price history</option>
              ${stores.map(store => `<option value="${escapeAttr(store._id)}"${String(store._id) === usualStoreId ? ' selected' : ''}>${escapeHtml(store.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="household-savings-threshold">Extra-stop savings ($)</label>
              <input class="form-control" type="number" id="household-savings-threshold" min="0" max="1000" step="0.01"
                value="${escapeAttr(household.settings?.additionalStopSavingsThreshold ?? 10)}" />
            </div>
            <div class="form-group">
              <label for="household-price-freshness">Price freshness (days)</label>
              <input class="form-control" type="number" id="household-price-freshness" min="1" max="365" step="1"
                value="${escapeAttr(household.settings?.priceFreshnessDays ?? 30)}" />
            </div>
          </div>
          <label class="trip-pantry-option" for="household-strict-price-review">
            <input type="checkbox" id="household-strict-price-review"${household.settings?.strictPriceReview ? ' checked' : ''} />
            <span><strong>Strict price review</strong><small>Require an admin to approve shopping-trip prices. Off by default for household trust.</small></span>
          </label>
          <button type="submit" class="btn btn-primary btn-full" style="margin-top:0.75rem">Save shopping defaults</button>
        </form>`;
    } else {
      html += `
        <h2 class="section-title" style="padding-left:0;margin-top:0.5rem">Shopping defaults</h2>
        <div class="household-settings-card text-sm">
          <div>Usual store: <strong>${escapeHtml(usualStore?.name || 'Inferred from price history')}</strong></div>
          <div class="text-muted">Another stop is suggested only above ${formatCurrency(Number(household.settings?.additionalStopSavingsThreshold ?? 10))} in estimated savings.</div>
        </div>`;
    }

    // Danger zone — delete household (owner only)
    if (auth.isOwner()) {
      html += `
        <div class="danger-zone" style="margin:1.5rem 0 0">
          <h3>Danger Zone</h3>
          <p>Permanently deletes the household and all its price history, items, stores, and Pantry data. All members will lose access.</p>
          <button class="btn btn-danger btn-full" id="btn-delete-household">Delete Household &amp; All Data</button>
        </div>`;
    }

    container.innerHTML = html;

    if (auth.isAdmin()) {
      document.getElementById('btn-show-invite').addEventListener('click', loadInviteCode);
    }

    const hhBarcodeToggle = document.getElementById('household-barcode-autaccept');
    if (hhBarcodeToggle) {
      hhBarcodeToggle.addEventListener('change', async () => {
        try {
          await api.household.updateSettings({ barcodeAutoAccept: hhBarcodeToggle.checked });
          showToast('Setting saved');
        } catch (err) {
          handleError(err, 'Failed to save setting');
          hhBarcodeToggle.checked = !hhBarcodeToggle.checked; // revert
        }
      });
    }

    document.getElementById('household-shopping-settings')?.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = formSubmitButton(event.target);
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        await api.household.updateSettings({
          usualStoreId: document.getElementById('household-usual-store').value || null,
          additionalStopSavingsThreshold: Number(document.getElementById('household-savings-threshold').value),
          priceFreshnessDays: Number(document.getElementById('household-price-freshness').value),
          strictPriceReview: document.getElementById('household-strict-price-review').checked
        });
        showToast('Shopping defaults saved');
      } catch (err) {
        handleError(err, 'Failed to save shopping defaults');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Save shopping defaults';
      }
    });

    if (auth.isOwner()) {
      document.getElementById('btn-delete-household').addEventListener('click', () => {
        const hhName = household.name;
        openModal('Delete Household', `
          <p style="margin-bottom:1rem"><strong>This will permanently delete:</strong></p>
          <ul style="font-size:var(--text-sm);color:var(--text-muted);margin:0 0 1rem 1.25rem;line-height:1.8">
            <li>All price entries and history</li>
            <li>All items and stores</li>
            <li>Pantry and shopping list</li>
            <li>All member accounts will be unlinked</li>
          </ul>
          <form id="delete-household-form">
            <div class="form-group">
              <label>Type the household name to confirm: <strong>${escapeHtml(hhName)}</strong></label>
              <input class="form-control" id="dh-name-confirm" required autocomplete="off" placeholder="${escapeAttr(hhName)}" />
            </div>
            <div class="form-group">
              <label>Enter your password</label>
              <input class="form-control" type="password" id="dh-password" required autocomplete="current-password" />
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
              <button type="submit" class="btn btn-danger">Delete Everything</button>
            </div>
          </form>`);

        document.getElementById('delete-household-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const typed = document.getElementById('dh-name-confirm').value.trim();
          if (typed !== hhName) {
            showToast('Household name does not match');
            return;
          }
          const btn = formSubmitButton(e.target);
          btn.disabled = true;
          btn.textContent = 'Deleting…';
          try {
            await api.household.deleteHousehold({ password: document.getElementById('dh-password').value });
            window.location.href = '/';
          } catch (err) {
            handleError(err, 'Failed to delete household');
            btn.disabled = false;
            btn.textContent = 'Delete Everything';
          }
        });
      });
    }
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load household info.');
  }
}

function renderMemberCard(m, auth, household) {
  const isMe = m._id === auth.user._id;
  const roleLabel = { owner: 'Owner', admin: 'Admin', member: 'Member' }[m.role];
  let actions = '';

  if (!isMe && auth.isOwner()) {
    if (m.role === 'member') {
      actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${m._id}','admin')">Make Admin</button>`;
    } else if (m.role === 'admin') {
      actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${m._id}','member')">Remove Admin</button>`;
    }
  }
  if (!isMe && auth.isAdmin() && m.role !== 'owner') {
    if (auth.isOwner() || m.role === 'member') {
      actions += `<button class="btn btn-danger btn-sm" onclick="removeMember('${m._id}')">Remove</button>`;
    }
  }

  return `
    <div class="member-card">
      <div class="member-avatar">${escapeHtml((m.name || '?')[0].toUpperCase())}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(m.name)}${isMe ? ' (you)' : ''}</div>
        <div class="member-role">${escapeHtml(roleLabel)}</div>
      </div>
      <div class="member-actions">${actions}</div>
    </div>`;
}

async function setMemberRole(memberId, role) {
  const action = role === 'admin' ? 'make this person an administrator' : 'remove this person’s administrator access';
  if (!confirm(`Are you sure you want to ${action}?`)) return;
  try {
    await api.household.updateMemberRole(memberId, role);
    showToast('Role updated');
    await loadHousehold();
  } catch (err) { handleError(err, 'Failed to update role'); }
}

async function removeMember(memberId) {
  if (!confirm('Remove this member from the household?')) return;
  try {
    await api.household.removeMember(memberId);
    showToast('Member removed');
    await loadHousehold();
  } catch (err) { handleError(err, 'Failed to remove member'); }
}

function openRenameHouseholdModal(currentName) {
  const bodyHTML = `
    <form id="rename-household-form">
      <div class="form-group">
        <label>Household Name</label>
        <input class="form-control" name="name" value="${escapeAttr(currentName)}" required />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  openModal('Rename Household', bodyHTML);
  document.getElementById('rename-household-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.household.update({ name: e.target.name.value.trim() });
      closeModal();
      showToast('Household renamed');
      // Update header
      window.appAuth.household.name = e.target.name.value.trim();
      await loadHousehold();
    } catch (err) { handleError(err, 'Failed to rename household'); }
  });
}

async function loadInviteCode() {
  const section = document.getElementById('invite-section');
  section.innerHTML = '<div class="spinner" style="margin:1rem auto"></div>';
  try {
    const { inviteCode, expiresAt } = await api.household.getInvite();
    const expStr = new Date(expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    // QR code served by the server to avoid CDN/CSP issues
    const qrSrc = `/api/household/invite/qr?t=${Date.now()}`;

    section.innerHTML = `
      <div class="invite-code-display">
        <div class="invite-code-value">${inviteCode}</div>
        <div class="invite-code-expiry">Expires ${expStr}</div>
        <img class="qr-img" src="${qrSrc}" alt="Join QR code" width="180" height="180" />
      </div>
      <button class="btn btn-outline btn-full" id="btn-regen-invite" style="margin-top:0.5rem">Regenerate Code</button>`;

    document.getElementById('btn-regen-invite').addEventListener('click', async () => {
      await api.household.regenerateInvite();
      showToast('New invite code generated');
      await loadInviteCode();
    });
  } catch (err) {
    section.innerHTML = `<p class="text-danger text-sm">Failed to load invite code.</p>`;
  }
}

function openAddCatalogItemModal() {
  promptCreateItem('', async () => {
    await loadCatalog();
    showToast('Item created');
  });
}

function openScanCatalogItemModal() {
  if (!window.BarcodeScanner) { showToast('Scanner unavailable. Try reloading the page.', 3000); return; }
  BarcodeScanner.open(async (upc) => {
    if (!upc) return;
    await handleBarcodeResult(upc, async () => {
      await loadCatalog();
      showToast('Item added via barcode scan');
    });
  });
}

// ===== About =====
function loadAboutSection() {
  const isAdmin = window.appAuth?.isAdmin();
  document.getElementById('about-content').innerHTML = `
    <div style="text-align:center;padding:1rem 0 1.5rem">
      <div style="margin-bottom:0.75rem">
        <img src="/brand/provista-mark.svg?v=b2-5" width="64" height="64" alt="" style="display:inline-block;border-radius:16px;box-shadow:var(--shadow-card-elevated)">
      </div>
      <h2 style="font-size:1.25rem;font-weight:800;margin-bottom:0.25rem">Provista</h2>
      <p style="color:var(--primary-light);font-size:0.875rem;font-weight:700">Plan together. Shop with clarity.</p>
      <p class="text-muted text-sm" style="margin-top:0.25rem">Version 1.0</p>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Why the name?</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.6">
          <strong style="color:var(--text)">Provista</strong> combines <em>provisions</em> — the food and essentials
          that keep a household moving — with <em>vista</em>, a clear view of what lies ahead. It brings meals,
          shopping, Pantry, and spending into one shared view, so your household can plan together and shop with clarity.
        </p>
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Why this app exists</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.6">
          Provista brings meal planning, the shared shopping list, Pantry, and household
          spending into one calm workflow. It helps everyone see what is next, shop with
          confidence, and keep the household moving together.
        </p>
      </div>
    </div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Features</div>
        <ul style="margin-top:0.5rem;padding-left:1.25rem;line-height:1.9;font-size:0.9rem;color:var(--text-muted)">
          <li>Price history by item &amp; store</li>
          <li>Shopping list with running cart total</li>
          <li>Pantry &amp; low-stock alerts</li>
          <li>Weekly meal planning</li>
          <li>Spending analytics by category &amp; store</li>
          <li>Household sharing with roles</li>
        </ul>
      </div>
    </div>
    <div class="card" style="margin-bottom:${isAdmin ? '1rem' : '0'}">
      <div class="card-body">
        <div class="card-title">Created by</div>
        <p style="margin-top:0.5rem;font-size:0.9375rem">Chris Phelan</p>
        <p class="text-muted text-sm" style="margin-top:0.25rem">Built for our household. Shared with yours.</p>
      </div>
    </div>
    ${isAdmin ? `
    <div class="card">
      <div class="card-body">
        <div class="card-title">Data Maintenance</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;margin-bottom:0.75rem">
          Normalize legacy category names (e.g. "Dry" → "Pantry") from older CSV imports.
        </p>
        <button class="btn btn-outline btn-sm" id="btn-migrate-categories">Fix Category Names</button>
        <div id="migrate-result" class="text-sm" style="margin-top:0.5rem"></div>
      </div>
    </div>` : ''}
  `;

  if (isAdmin) {
    document.getElementById('btn-migrate-categories')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-migrate-categories');
      const result = document.getElementById('migrate-result');
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        const res = await api.request('POST', '/admin/migrate-categories');
        result.textContent = res.message;
        result.style.color = 'var(--success)';
      } catch (err) {
        result.textContent = 'Failed: ' + err.message;
        result.style.color = 'var(--danger)';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Fix Category Names';
      }
    });
  }
}

// ===== Swipe-to-delete helper =====
function attachSwipeDelete(card) {
  let startX = 0;
  let startY = 0;
  let swiping = false;

  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Only intercept clear horizontal swipes
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      swiping = true;
    }
  }, { passive: true });

  card.addEventListener('touchend', (e) => {
    if (!swiping) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx < -40) {
      // Swipe left → reveal delete
      card.classList.add('swiped');
      // Dismiss other swiped cards
      document.querySelectorAll('.card.swipeable.swiped').forEach(c => {
        if (c !== card) c.classList.remove('swiped');
      });
    } else if (dx > 20) {
      // Swipe right → hide delete
      card.classList.remove('swiped');
    }
  });

  // Tap anywhere outside the swipe-delete area collapses it
  document.addEventListener('touchstart', (e) => {
    if (card.classList.contains('swiped') && !card.contains(e.target)) {
      card.classList.remove('swiped');
    }
  }, { passive: true });
}

// ===== Init =====
async function handleMoreSectionNav(section) {
  showMoreSection(section);
  if (section === 'insights') return;
  if (section === 'items') await loadCatalog();
  else if (section === 'stores') await loadStores();
  else if (section === 'household') await loadHousehold();
  else if (section === 'account') await loadAccountSettings();
  else if (section === 'about') loadAboutSection();
}

function initMoreTab() {
  document.querySelectorAll('.more-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => handleMoreSectionNav(btn.dataset.section));
  });

  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', hideMoreSection);
  });

  document.querySelectorAll('[data-insight-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.insightTab));
  });
  document.querySelectorAll('.insights-back').forEach(btn => {
    btn.addEventListener('click', async () => {
      await switchTab('more');
      showMoreSection('insights');
    });
  });

  document.getElementById('btn-add-inventory')?.addEventListener('click', openAddInventoryModal);
  document.getElementById('pantry-search')?.addEventListener('input', event => {
    inventoryState.search = event.target.value;
    renderInventory();
  });
  document.getElementById('btn-add-item-catalog').addEventListener('click', openAddCatalogItemModal);
  const scanCatalogBtn = document.getElementById('btn-scan-catalog');
  if (scanCatalogBtn) {
    scanCatalogBtn.addEventListener('click', openScanCatalogItemModal);
    if (!window.appAuth?.features?.barcodeScanning) scanCatalogBtn.style.display = 'none';
  }
  document.getElementById('btn-add-store').addEventListener('click', () => {
    promptCreateStore('', async (store) => {
      await loadStores();
      showToast('Store added');
    });
  });

  document.getElementById('catalog-search').addEventListener('input', applyCatalogFilter);
  document.getElementById('btn-catalog-filter')?.addEventListener('click', openCatalogFilterSheet);

  document.getElementById('btn-app-tour').addEventListener('click', () => {
    startAppTour();
  });

  document.getElementById('btn-more-csv-import')?.addEventListener('click', () => {
    openCsvImportModal();
  });

  const resumeBtn = document.getElementById('btn-resume-setup');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      startSetupWizard();
    });
  }
}
