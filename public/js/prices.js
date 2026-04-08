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

    // Load pending review section (moved from scan tab) and badge count
    if (window.appAuth?.isAdmin()) {
      try {
        await loadScanPendingSection();
      } catch (_) {}
    }
  } catch (err) {
    handleError(err, 'Failed to load prices');
  }
}

function renderPricesList(entries) {
  const container = document.getElementById('prices-list');
  if (!entries.length) {
    container.innerHTML = emptyState('💰', 'No approved price entries yet. Tap "+ Add Price" to get started.');
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
    const hasSale = latest.salePrice != null;
    const hasCoupon = latest.couponAmount != null && latest.couponAmount > 0;
    const isOrganic = item?.isOrganic;
    const badges = [
      isOrganic ? `<span class="badge badge-organic">Organic</span>` : '',
      hasSale ? `<span class="badge badge-sale">Sale</span>` : '',
      hasCoupon ? `<span class="badge badge-coupon">Coupon</span>` : ''
    ].filter(Boolean).join(' ');
    return `
      <div class="card" onclick="openItemDetail('${item?._id}', '${(item?.name || '').replace(/'/g, "\\'")}')">
        <div class="card-body">
          <div class="card-title">${item?.name || 'Unknown item'}</div>
          <div class="card-subtitle">${item?.category || ''} &middot; ${storeName} &middot; ${formatDate(latest.date)}</div>
          <div style="margin-top:4px">${badges}</div>
        </div>
        <div class="card-meta">
          <div class="price-big">${formatCurrency(latest.finalPrice)}</div>
          <div class="price-unit">${formatPPU(latest.pricePerUnit, unit)}</div>
        </div>
      </div>`;
  }).join('');
}

async function openItemDetail(itemId, itemName) {
  const panel = document.getElementById('item-detail-panel');
  document.getElementById('detail-item-name').textContent = itemName;
  panel.style.display = 'block';
  panel.classList.add('open');
  await Promise.all([loadDetailHistory(itemId), loadDetailCompare(itemId)]);
}

async function loadDetailHistory(itemId) {
  const container = document.getElementById('detail-history');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const entries = await api.prices.history(itemId);
    if (!entries.length) { container.innerHTML = emptyState('📋', 'No price history yet.'); return; }

    const unit = entries[0].itemId?.unit || 'unit';
    const approvedEntries = entries.filter(e => e.status === 'approved');
    const minPPU = approvedEntries.length ? Math.min(...approvedEntries.map(e => e.pricePerUnit)) : null;

    // Callout if different quantities exist
    const sizes = [...new Set(entries.map(e => e.quantity))];
    let callout = sizes.length > 1 ? buildCallout(approvedEntries) : '';

    container.innerHTML = callout + entries.map(e => {
      const isBest = minPPU !== null && e.status === 'approved' && Math.abs(e.pricePerUnit - minPPU) < 0.001;
      const isPending = e.status === 'pending';
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;

      const statusBadge = isPending
        ? `<span class="badge badge-pending">Pending review</span>`
        : isBest ? `<span class="badge badge-best">Best</span>` : '';

      const priceLine = hasSale || hasCoupon ? `
        <div class="price-breakdown">
          <span class="price-breakdown-reg">${formatCurrency(e.regularPrice)} reg</span>
          ${hasSale ? `<span class="price-breakdown-sale">→ ${formatCurrency(e.salePrice)} sale</span>` : ''}
          ${hasCoupon ? `<span class="price-breakdown-coupon">− ${formatCurrency(e.couponAmount)} coupon${e.couponCode ? ` (${e.couponCode})` : ''}</span>` : ''}
        </div>` : '';

      const organicBadge = e.isOrganic ? `<span class="badge badge-organic">Organic</span> ` : '';
      const saleBadge = hasSale ? `<span class="badge badge-sale">Sale</span> ` : '';
      const couponBadge = hasCoupon ? `<span class="badge badge-coupon">Coupon</span> ` : '';
      const canDelete = window.appAuth?.isAdmin() && !isPending;

      return `
        <div class="card" style="margin-bottom:0.5rem;${isPending ? 'opacity:0.8;border-left:3px solid var(--warning)' : ''}">
          <div class="card-body">
            <div class="card-title">${e.storeId?.name || 'Unknown'}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity} &middot; by ${e.submittedBy?.name || '—'}</div>
            <div style="margin-top:4px">${organicBadge}${saleBadge}${couponBadge}${statusBadge}</div>
            ${priceLine}
            ${e.notes ? `<div class="text-muted text-sm" style="margin-top:4px">${e.notes}</div>` : ''}
          </div>
          <div class="card-meta">
            <div class="price-big ${isBest ? 'price-best' : ''}">${formatCurrency(e.finalPrice)}</div>
            <div class="price-unit">${formatPPU(e.pricePerUnit, unit)}</div>
            ${canDelete ? `<button class="btn btn-icon text-danger" onclick="deletePriceEntry('${e._id}','${itemId}')" style="font-size:1rem;min-height:32px;min-width:32px">✕</button>` : ''}
          </div>
        </div>`;
    }).join('');

    loadDetailTrend(itemId, approvedEntries);
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load history.');
  }
}

async function loadDetailCompare(itemId) {
  const container = document.getElementById('detail-compare');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const entries = await api.prices.compare(itemId);
    if (!entries.length) { container.innerHTML = emptyState('🏪', 'No approved price comparisons yet.'); return; }
    const unit = entries[0].item?.unit || 'unit';
    let callout = entries.length > 1 ? buildCallout(entries) : '';
    container.innerHTML = callout + entries.map((e, i) => {
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      return `
        <div class="card" style="margin-bottom:0.5rem">
          <div class="card-body">
            <div class="card-title">${e.store?.name || 'Unknown'}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity}</div>
            <div style="margin-top:4px">
              ${i === 0 ? `<span class="badge badge-best">Best price</span>` : ''}
              ${hasSale ? `<span class="badge badge-sale">Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">Coupon</span>` : ''}
            </div>
          </div>
          <div class="card-meta">
            <div class="price-big ${i === 0 ? 'price-best' : ''}">${formatCurrency(e.finalPrice)}</div>
            <div class="price-unit">${formatPPU(e.pricePerUnit, unit)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load comparison.');
  }
}

function loadDetailTrend(itemId, entries) {
  if (!entries || !entries.length) return;
  const byStore = {};
  entries.forEach(e => {
    const sid = e.storeId?._id || e.storeId;
    const sname = e.storeId?.name || 'Unknown';
    if (!byStore[sid]) byStore[sid] = { label: sname, points: [] };
    byStore[sid].points.push({ x: e.date, y: e.pricePerUnit, sale: e.salePrice != null || (e.couponAmount != null && e.couponAmount > 0) });
  });
  const datasets = Object.values(byStore).map(s => ({ label: s.label, points: s.points.sort((a, b) => new Date(a.x) - new Date(b.x)) }));
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

// Live final-price calculator used in the add-price modal
function recalcPricePreview() {
  const reg = parseFloat(document.getElementById('price-regular')?.value) || 0;
  const saleOn = document.getElementById('price-on-sale')?.checked;
  const sale = saleOn ? (parseFloat(document.getElementById('price-sale')?.value) || null) : null;
  const couponOn = document.getElementById('price-coupon-used')?.checked;
  const coupon = couponOn ? (parseFloat(document.getElementById('price-coupon-amount')?.value) || 0) : 0;
  const qty = parseFloat(document.getElementById('price-qty')?.value) || 1;

  const base = (sale != null && sale < reg) ? sale : reg;
  const final = Math.max(0, base - coupon);
  const ppu = qty > 0 ? final / qty : final;

  const preview = document.getElementById('price-calc-preview');
  if (preview && reg > 0) {
    preview.textContent = `Final: ${formatCurrency(final)} · ${formatPPU(ppu, document.getElementById('price-item-unit')?.value || 'unit')}`;
    preview.style.display = '';
  } else if (preview) {
    preview.style.display = 'none';
  }
}

function openAddPriceModal(prefillItem, onSaved) {
  const isAdmin = window.appAuth?.isAdmin();
  const submitLabel = isAdmin ? 'Save Entry' : 'Submit for Review';
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
          <label>Regular Price ($)</label>
          <input class="form-control" type="number" id="price-regular" step="0.01" min="0" required placeholder="0.00" />
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
        <label for="price-on-sale">On Sale</label>
      </div>
      <div class="form-group" id="price-sale-group" style="display:none">
        <label>Sale Price ($)</label>
        <input class="form-control" type="number" id="price-sale" step="0.01" min="0" placeholder="Discounted shelf price" />
      </div>

      <div class="checkbox-row">
        <input type="checkbox" id="price-coupon-used" />
        <label for="price-coupon-used">Used Coupon</label>
      </div>
      <div id="price-coupon-group" style="display:none">
        <div class="form-row">
          <div class="form-group">
            <label>Coupon Amount ($)</label>
            <input class="form-control" type="number" id="price-coupon-amount" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label>Coupon Label</label>
            <input class="form-control" id="price-coupon-code" placeholder="e.g. Ibotta" />
          </div>
        </div>
      </div>

      <div id="price-calc-preview" class="price-calc-preview" style="display:none"></div>

      <div class="checkbox-row">
        <input type="checkbox" id="price-organic" />
        <label for="price-organic">Organic</label>
      </div>

      <div class="form-group" style="margin-top:0.5rem">
        <label>Notes (optional)</label>
        <input class="form-control" id="price-notes" placeholder="e.g. Store brand" />
      </div>
      ${!isAdmin ? `<div class="callout-box" style="margin-bottom:0.75rem">As a member, your entry will be pending admin review before it appears in price history.</div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${submitLabel}</button>
      </div>
    </form>`;

  openModal(isAdmin ? 'Log Price' : 'Submit Price', bodyHTML);

  // Toggles
  document.getElementById('price-on-sale').addEventListener('change', (e) => {
    document.getElementById('price-sale-group').style.display = e.target.checked ? '' : 'none';
    recalcPricePreview();
  });
  document.getElementById('price-coupon-used').addEventListener('change', (e) => {
    document.getElementById('price-coupon-group').style.display = e.target.checked ? '' : 'none';
    recalcPricePreview();
  });

  // Live calculation on any input
  ['price-regular', 'price-sale', 'price-coupon-amount', 'price-qty'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalcPricePreview);
  });

  // Item autocomplete
  const itemInput = document.getElementById('price-item-input');
  const itemDropdown = document.getElementById('price-item-dropdown');
  attachItemAutocomplete(itemInput, itemDropdown, {
    onSelect(item) {
      document.getElementById('price-item-id').value = item._id;
      document.getElementById('price-item-unit').value = item.unit;
      recalcPricePreview();
    },
    onCreateNew: isAdmin ? (name) => {
      promptCreateItem(name, (item) => {
        itemInput.value = item.name;
        document.getElementById('price-item-id').value = item._id;
        document.getElementById('price-item-unit').value = item.unit;
        openAddPriceModal(item);
      });
    } : null
  });

  // Store autocomplete
  const storeInput = document.getElementById('price-store-input');
  const storeDropdown = document.getElementById('price-store-dropdown');
  attachStoreAutocomplete(storeInput, storeDropdown, {
    onSelect(store) { document.getElementById('price-store-id').value = store._id; },
    onCreateNew: isAdmin ? (name) => {
      promptCreateStore(name, (store) => {
        storeInput.value = store.name;
        document.getElementById('price-store-id').value = store._id;
      });
    } : null
  });

  // Form submit
  document.getElementById('add-price-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = document.getElementById('price-item-id').value;
    const storeId = document.getElementById('price-store-id').value;
    if (!itemId) { showToast('Please select an item from the list'); return; }
    if (!storeId) { showToast('Please select a store from the list'); return; }

    const regularPrice = parseFloat(document.getElementById('price-regular').value);
    const saleOn = document.getElementById('price-on-sale').checked;
    const salePrice = saleOn ? (parseFloat(document.getElementById('price-sale').value) || null) : null;
    const couponOn = document.getElementById('price-coupon-used').checked;
    const couponAmount = couponOn ? (parseFloat(document.getElementById('price-coupon-amount').value) || null) : null;
    const couponCode = couponOn ? document.getElementById('price-coupon-code').value.trim() : null;
    const quantity = parseFloat(document.getElementById('price-qty').value);

    const data = {
      itemId, storeId,
      regularPrice,
      salePrice,
      couponAmount,
      couponCode,
      quantity,
      isOrganic: document.getElementById('price-organic').checked,
      date: document.getElementById('price-date').value,
      notes: document.getElementById('price-notes').value.trim(),
      source: 'manual'
    };
    try {
      const result = await api.prices.create(data);
      closeModal();
      window.onWizardActionComplete?.('add-price');
      if (onSaved) {
        onSaved(result);
      } else if (result.status === 'pending') {
        showToast('Submitted for review');
      } else {
        showToast('Price entry saved');
        await loadPricesTab();
      }
    } catch (err) {
      handleError(err, 'Failed to save price entry');
    }
  });
}

// =============================================================
// Pending Review (admin+) — rendered in the Prices tab
// =============================================================

async function loadScanPendingSection() {
  const section = document.getElementById('scan-pending-section');
  const container = document.getElementById('scan-pending-list');
  if (!section || !container) return;
  section.style.display = '';

  try {
    const entries = await api.prices.pending();
    updatePendingBadge(entries.length);

    if (!entries.length) {
      container.innerHTML = emptyState('✅', 'No entries pending review.');
      return;
    }

    container.innerHTML = entries.map(e => {
      const name = e.itemId?.name || 'Unknown item';
      const unit = e.itemId?.unit || 'unit';
      const store = e.storeId?.name || 'Unknown store';
      const submitter = e.submittedBy?.name || 'Unknown';
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      const isOrganic = e.isOrganic;
      return `
        <div class="pending-card" id="pending-${e._id}">
          <div class="pending-card-header">
            <div>
              <div style="font-weight:600">${name}${isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}</div>
              <div class="text-muted text-sm">${store} &middot; ${formatDate(e.date)} &middot; by ${submitter}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:1.1rem">${formatCurrency(e.finalPrice)}</div>
              <div class="text-muted text-sm">${formatPPU(e.pricePerUnit, unit)}</div>
              ${hasSale ? `<span class="badge badge-sale">Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">Coupon</span>` : ''}
            </div>
          </div>
          ${e.notes ? `<div class="text-muted text-sm">${e.notes}</div>` : ''}
          <div class="pending-card-actions">
            <button class="btn btn-outline btn-sm" onclick="openApprovePriceModal('${e._id}', ${JSON.stringify(e).replace(/"/g, '&quot;')})">Edit &amp; Approve</button>
            <button class="btn btn-primary btn-sm" onclick="quickApprovePrice('${e._id}')">Approve ✓</button>
            <button class="btn btn-danger btn-sm" onclick="rejectPriceEntry('${e._id}')">Reject</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load pending entries.');
  }
}

async function quickApprovePrice(id) {
  try {
    await api.prices.approve(id);
    showToast('Entry approved');
    await loadScanPendingSection();
    await loadPricesTab();
  } catch (err) {
    handleError(err, 'Failed to approve entry');
  }
}

function openApprovePriceModal(id, entryRaw) {
  openApproveModal(id, entryRaw, async () => {
    await loadScanPendingSection();
    await loadPricesTab();
  });
}

async function rejectPriceEntry(id) {
  if (!confirm('Reject and delete this entry?')) return;
  try {
    await api.prices.reject(id);
    showToast('Entry rejected');
    await loadScanPendingSection();
  } catch (err) {
    handleError(err, 'Failed to reject entry');
  }
}

function openApproveModal(id, entryRaw, onSuccess) {
  const bodyHTML = `
    <form id="approve-form">
      <div class="form-row">
        <div class="form-group">
          <label>Regular Price ($)</label>
          <input class="form-control" type="number" step="0.01" min="0" id="approve-reg-price" value="${entryRaw.regularPrice}" required />
        </div>
        <div class="form-group">
          <label>Quantity</label>
          <input class="form-control" type="number" step="any" min="0.01" id="approve-qty" value="${entryRaw.quantity}" required />
        </div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="approve-organic" ${entryRaw.isOrganic ? 'checked' : ''} />
        <label for="approve-organic">Organic</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="approve-sale" ${entryRaw.salePrice != null ? 'checked' : ''} />
        <label for="approve-sale">On Sale</label>
      </div>
      <div id="approve-sale-group" style="${entryRaw.salePrice != null ? '' : 'display:none'}">
        <div class="form-group">
          <label>Sale Price ($)</label>
          <input class="form-control" type="number" step="0.01" min="0" id="approve-sale-price" value="${entryRaw.salePrice || ''}" />
        </div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="approve-coupon" ${entryRaw.couponAmount != null ? 'checked' : ''} />
        <label for="approve-coupon">Used Coupon</label>
      </div>
      <div id="approve-coupon-group" style="${entryRaw.couponAmount != null ? '' : 'display:none'}">
        <div class="form-row">
          <div class="form-group">
            <label>Coupon Amount ($)</label>
            <input class="form-control" type="number" step="0.01" min="0" id="approve-coupon-amount" value="${entryRaw.couponAmount || ''}" />
          </div>
          <div class="form-group">
            <label>Coupon Label</label>
            <input class="form-control" id="approve-coupon-code" value="${entryRaw.couponCode || ''}" placeholder="e.g. Ibotta" />
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="form-control" type="date" id="approve-date" value="${new Date(entryRaw.date).toISOString().slice(0,10)}" />
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input class="form-control" id="approve-notes" value="${entryRaw.notes || ''}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Approve</button>
      </div>
    </form>`;

  openModal('Edit & Approve', bodyHTML);

  document.getElementById('approve-sale').addEventListener('change', (e) => {
    document.getElementById('approve-sale-group').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('approve-coupon').addEventListener('change', (e) => {
    document.getElementById('approve-coupon-group').style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('approve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saleOn = document.getElementById('approve-sale').checked;
    const couponOn = document.getElementById('approve-coupon').checked;
    try {
      await api.prices.approve(id, {
        isOrganic: document.getElementById('approve-organic').checked,
        regularPrice: parseFloat(document.getElementById('approve-reg-price').value),
        quantity: parseFloat(document.getElementById('approve-qty').value),
        salePrice: saleOn ? (parseFloat(document.getElementById('approve-sale-price').value) || null) : null,
        couponAmount: couponOn ? (parseFloat(document.getElementById('approve-coupon-amount').value) || null) : null,
        couponCode: couponOn ? document.getElementById('approve-coupon-code').value.trim() : null,
        date: document.getElementById('approve-date').value,
        notes: document.getElementById('approve-notes').value.trim()
      });
      closeModal();
      showToast('Entry approved');
      if (onSuccess) await onSuccess();
    } catch (err) {
      handleError(err, 'Failed to approve entry');
    }
  });
}

function initPricesTab() {
  document.getElementById('btn-add-price').addEventListener('click', () => openAddPriceModal(null));

  document.getElementById('price-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = pricesState.entries.filter(entry =>
      (entry.itemId?.name || '').toLowerCase().includes(q) ||
      (entry.itemId?.category || '').toLowerCase().includes(q) ||
      (entry.storeId?.name || '').toLowerCase().includes(q)
    );
    renderPricesList(filtered);
  });

  document.querySelectorAll('.detail-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.detail-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById('detail-' + btn.dataset.detail);
      if (target) target.classList.add('active');
    });
  });

  document.getElementById('close-detail').addEventListener('click', () => {
    const panel = document.getElementById('item-detail-panel');
    panel.classList.remove('open');
    setTimeout(() => { panel.style.display = 'none'; }, 250);
  });
}
