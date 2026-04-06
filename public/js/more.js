// More tab: Inventory, Item Catalog, Stores, Household, Account

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
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
          await api.auth.deleteAccount({ password: document.getElementById('da-password').value });
          window.location.href = '/login.html';
        } catch (err) {
          handleError(err, 'Failed to delete account');
          btn.disabled = false;
          btn.textContent = 'Delete Account';
        }
      });
    });
  }
}

// ===== Inventory (admin+) =====
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
    await api.inventory.update(id, { quantity: newQty });
    const item = inventoryState.items.find(i => i._id === id);
    if (item) item.quantity = newQty;
    if (newQty === 0) inventoryState.items = inventoryState.items.filter(i => i._id !== id);
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

  attachItemAutocomplete(document.getElementById('inv-item-input'), document.getElementById('inv-item-dropdown'), {
    onSelect(item) {
      document.getElementById('inv-item-id').value = item._id;
      document.getElementById('inv-item-unit').value = item.unit;
    },
    onCreateNew(name) {
      promptCreateItem(name, (item) => {
        document.getElementById('inv-item-input').value = item.name;
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
    try {
      await api.inventory.save({
        itemId,
        quantity: parseFloat(document.getElementById('inv-qty').value),
        unit: document.getElementById('inv-item-unit').value,
        notes: document.getElementById('inv-notes').value.trim()
      });
      closeModal();
      showToast('Added to inventory');
      await loadInventory();
    } catch (err) {
      handleError(err, 'Failed to add to inventory');
    }
  });
}

// ===== Item Catalog (admin+) =====
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
          <input class="form-control" name="category" value="${category}" required list="cat-dl" />
          <datalist id="cat-dl">
            <option value="Produce"/><option value="Dairy"/><option value="Meat &amp; Seafood"/>
            <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
            <option value="Beverages"/><option value="Snacks"/>
            <option value="Condiments &amp; Sauces"/><option value="Cleaning &amp; Household"/>
          </datalist>
        </div>
        <div class="form-group">
          <label>Unit</label>
          <input class="form-control" name="unit" value="${unit}" required list="unit-dl" />
          <datalist id="unit-dl">
            <option value="lb"/><option value="oz"/><option value="each"/>
            <option value="fl oz"/><option value="gal"/><option value="dozen"/>
            <option value="pack"/><option value="count"/><option value="loaf"/>
          </datalist>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  openModal('Edit Item', bodyHTML);
  document.getElementById('edit-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api.items.update(id, { name: form.name.value.trim(), category: form.category.value.trim(), unit: form.unit.value.trim() });
      closeModal();
      showToast('Item updated');
      await loadCatalog();
    } catch (err) { handleError(err, 'Failed to update item'); }
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
    const { household, members } = await api.household.get();
    const auth = window.appAuth;

    let html = `
      <div class="card" style="margin-bottom:0.75rem">
        <div class="card-body">
          <div class="card-title">${household.name}</div>
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

    // Danger zone — delete household (owner only)
    if (auth.isOwner()) {
      html += `
        <div class="danger-zone" style="margin:1.5rem 0 0">
          <h3>Danger Zone</h3>
          <p>Permanently deletes the household and all its price history, items, stores, and inventory. All members will lose access.</p>
          <button class="btn btn-danger btn-full" id="btn-delete-household">Delete Household &amp; All Data</button>
        </div>`;
    }

    container.innerHTML = html;

    if (auth.isAdmin()) {
      document.getElementById('btn-show-invite').addEventListener('click', loadInviteCode);
    }

    if (auth.isOwner()) {
      document.getElementById('btn-delete-household').addEventListener('click', () => {
        const hhName = household.name;
        openModal('Delete Household', `
          <p style="margin-bottom:1rem"><strong>This will permanently delete:</strong></p>
          <ul style="font-size:var(--text-sm);color:var(--text-muted);margin:0 0 1rem 1.25rem;line-height:1.8">
            <li>All price entries and history</li>
            <li>All items and stores</li>
            <li>Inventory and shopping list</li>
            <li>All member accounts will be unlinked</li>
          </ul>
          <form id="delete-household-form">
            <div class="form-group">
              <label>Type the household name to confirm: <strong>${hhName}</strong></label>
              <input class="form-control" id="dh-name-confirm" required autocomplete="off" placeholder="${hhName}" />
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
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true;
          btn.textContent = 'Deleting…';
          try {
            await api.household.deleteHousehold({ password: document.getElementById('dh-password').value });
            window.location.href = '/login.html';
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
      <div class="member-avatar">${(m.name || '?')[0].toUpperCase()}</div>
      <div class="member-info">
        <div class="member-name">${m.name}${isMe ? ' (you)' : ''}</div>
        <div class="member-role">${roleLabel}</div>
      </div>
      <div class="member-actions">${actions}</div>
    </div>`;
}

async function setMemberRole(memberId, role) {
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
        <input class="form-control" name="name" value="${currentName}" required />
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
    const joinUrl = `${window.location.origin}/join?code=${inviteCode}`;

    section.innerHTML = `
      <div class="invite-code-display">
        <div class="invite-code-value">${inviteCode}</div>
        <div class="invite-code-expiry">Expires ${expStr}</div>
        <canvas id="qr-canvas" width="180" height="180"></canvas>
      </div>
      <button class="btn btn-outline btn-full" id="btn-regen-invite" style="margin-top:0.5rem">Regenerate Code</button>`;

    document.getElementById('btn-regen-invite').addEventListener('click', async () => {
      await api.household.regenerateInvite();
      showToast('New invite code generated');
      await loadInviteCode();
    });

    // QR code is optional — if the CDN is unavailable the code is still shown
    try {
      await generateQR('qr-canvas', joinUrl);
    } catch (_) {
      const canvas = document.getElementById('qr-canvas');
      if (canvas) canvas.remove();
    }
  } catch (err) {
    section.innerHTML = `<p class="text-danger text-sm">Failed to load invite code.</p>`;
  }
}

async function generateQR(canvasId, text) {
  // Load qrcode.js from CDN if not present
  if (!window.QRCode) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const canvas = document.getElementById(canvasId);
  await QRCode.toCanvas(canvas, text, { width: 180, margin: 1 });
}

// ===== Helper =====
function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function openAddCatalogItemModal() {
  promptCreateItem('', async () => {
    await loadCatalog();
    showToast('Item created');
  });
}

// ===== Init =====
function initMoreTab() {
  document.querySelectorAll('.more-item[data-section]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      showMoreSection(section);
      if (section === 'inventory') await loadInventory();
      else if (section === 'items') await loadCatalog();
      else if (section === 'stores') await loadStores();
      else if (section === 'household') await loadHousehold();
      else if (section === 'account') await loadAccountSettings();
    });
  });

  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', hideMoreSection);
  });

  document.getElementById('btn-add-inventory').addEventListener('click', openAddInventoryModal);
  document.getElementById('btn-add-item-catalog').addEventListener('click', openAddCatalogItemModal);
  document.getElementById('btn-add-store').addEventListener('click', () => {
    promptCreateStore('', async (store) => {
      await loadStores();
      showToast('Store added');
    });
  });

  document.getElementById('catalog-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    catalogState.filtered = catalogState.items.filter(item =>
      item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
    renderCatalog();
  });

  document.getElementById('btn-app-tour').addEventListener('click', () => {
    startAppTour();
  });

  const resumeBtn = document.getElementById('btn-resume-setup');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      startSetupWizard();
    });
  }
}
