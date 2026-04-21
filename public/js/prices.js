// Prices tab logic

let pricesState = {
  entries: [],
  searchQuery: '',
  filter: {
    categories: [],
    stores: [],
    dateRange: 'all',
    organicOnly: false,
    saleOnly: false,
    sortBy: 'date'
  }
};
// Expose globally so more.js catalog filter can read entries for last-purchased sort
window.pricesState = pricesState;

// ===== Similar-item clustering =====
// Groups price-list items whose normalized names are within Levenshtein distance ≤ 3.
// Reuses _levenshtein() from csvImport.js (loaded before this file in index.html).

function _normItemName(name) {
  return name.toLowerCase().trim()
    .replace(/\s*[-–]\s*(lrg|large|sm|small|med|medium)\s*$/i, '')
    .replace(/s$/, '');
}

function clusterItemGroups(groups) {
  if (typeof _levenshtein !== 'function') return groups.map(g => ({ canonical: g, members: [g] }));
  const clusters = [];
  const used = new Set();
  groups.forEach((g, i) => {
    if (used.has(i)) return;
    const normA = _normItemName(g.item?.name || '');
    const members = [g];
    groups.forEach((h, j) => {
      if (j === i || used.has(j)) return;
      const normB = _normItemName(h.item?.name || '');
      if (normA && normB && _levenshtein(normA, normB) <= 3) {
        members.push(h);
        used.add(j);
      }
    });
    used.add(i);
    // Canonical = member with most entries; alphabetical on tie
    const canonical = members.reduce((best, m) =>
      m.entries.length > best.entries.length ||
      (m.entries.length === best.entries.length && (m.item?.name || '') < (best.item?.name || ''))
        ? m : best, members[0]);
    clusters.push({ canonical, members });
  });
  return clusters;
}

async function loadPricesTab() {
  // Show skeleton immediately so users know data is loading
  const pricesList = document.getElementById('prices-list');
  pricesList.innerHTML = [1, 2, 3, 4].map(() => `
    <div class="card skeleton-card">
      <div class="card-body">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-subtitle"></div>
        <div class="skeleton-line skeleton-meta"></div>
      </div>
      <div class="card-meta" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="skeleton-line skeleton-price"></div>
        <div class="skeleton-line skeleton-ppu"></div>
      </div>
    </div>`).join('');

  try {
    const entries = await api.prices.list();
    pricesState.entries = entries;
    window.pricesState = pricesState; // keep global ref fresh
    applyPricesFilter();

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

function renderPricesList(clusters) {
  const container = document.getElementById('prices-list');

  if (!clusters.length) {
    container.innerHTML = emptyState('💰', 'No approved price entries yet. Tap "+ Add Price" to get started.');
    return;
  }

  container.innerHTML = clusters.map((cluster, idx) => {
    const { canonical, members } = cluster;
    const { item, entries: es } = canonical;
    const latest = es[0];
    const storeName = escapeHtml(latest.storeId?.name || 'Unknown store');
    const unit = item?.unit || 'unit';
    const hasSale = latest.salePrice != null;
    const hasCoupon = latest.couponAmount != null && latest.couponAmount > 0;
    const isOrganic = item?.isOrganic;
    const isMulti = members.length > 1;
    const badges = [
      isOrganic ? `<span class="badge badge-organic">🌿 Organic</span>` : '',
      hasSale ? `<span class="badge badge-sale">🏷️ Sale</span>` : '',
      hasCoupon ? `<span class="badge badge-coupon">✂️ Coupon</span>` : '',
      isMulti ? `<span class="badge badge-muted">${members.length} variants</span>` : ''
    ].filter(Boolean).join(' ');
    return `
      <div class="card price-list-card" data-cluster-idx="${idx}">
        <div class="card-body">
          <div class="card-title">${escapeHtml(item?.name || 'Unknown item')}${item?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(item.brand) + ')</span>' : ''}</div>
          <div class="card-subtitle">${item ? formatItemMeta(item) : ''} &middot; ${storeName} &middot; ${formatDate(latest.date)}</div>
          <div style="margin-top:4px">${badges}</div>
        </div>
        <div class="card-meta">
          <div class="price-big">${formatCurrency(latest.finalPrice)}</div>
          <div class="price-unit">${formatPPU(latest.pricePerUnit, escapeHtml(unit))}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.price-list-card').forEach(card => {
    const idx = +card.dataset.clusterIdx;
    card.addEventListener('click', () => openClusterDetail(clusters[idx]));
  });
}

function applyPricesFilter() {
  const { filter, entries, searchQuery } = pricesState;
  const cutoffDays = { '7d': 7, '30d': 30, '90d': 90 };
  const cutoff = cutoffDays[filter.dateRange]
    ? new Date(Date.now() - cutoffDays[filter.dateRange] * 86400000) : null;

  const filtered = entries.filter(e => {
    if (filter.categories.length && !filter.categories.includes(e.itemId?.category)) return false;
    if (filter.stores.length && !filter.stores.includes(String(e.storeId?._id || e.storeId))) return false;
    if (cutoff && new Date(e.date) < cutoff) return false;
    if (filter.organicOnly && !e.itemId?.isOrganic) return false;
    if (filter.saleOnly && e.salePrice == null) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(e.itemId?.name || '').toLowerCase().includes(q) &&
          !(e.itemId?.category || '').toLowerCase().includes(q) &&
          !(e.storeId?.name || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Group by item
  const byItem = {};
  filtered.forEach(e => {
    const id = e.itemId?._id || e.itemId;
    if (!byItem[id]) byItem[id] = { item: e.itemId, entries: [] };
    byItem[id].entries.push(e);
  });
  let groups = Object.values(byItem);

  // Sort
  if (filter.sortBy === 'name') {
    groups.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''));
  } else if (filter.sortBy === 'price') {
    groups.sort((a, b) => (a.entries[0]?.finalPrice || 0) - (b.entries[0]?.finalPrice || 0));
  } else if (filter.sortBy === 'ppu') {
    groups.sort((a, b) => (a.entries[0]?.pricePerUnit || 0) - (b.entries[0]?.pricePerUnit || 0));
  }
  // 'date': entries already sorted newest-first from API

  const clusters = clusterItemGroups(groups);
  pricesState.clusters = clusters;

  // Update count bar
  const totalGroups = new Set(entries.map(e => e.itemId?._id || e.itemId)).size;
  const isFiltered = filter.categories.length || filter.stores.length ||
    filter.dateRange !== 'all' || filter.organicOnly || filter.saleOnly;
  const countBar = document.getElementById('prices-filter-count');
  if (countBar) {
    countBar.textContent = isFiltered ? `Showing ${clusters.length} of ${totalGroups} items` : '';
    countBar.style.display = isFiltered ? '' : 'none';
  }
  const dot = document.getElementById('prices-filter-dot');
  if (dot) dot.style.display = (isFiltered || filter.sortBy !== 'date') ? '' : 'none';

  renderPricesList(clusters);
}

function openPricesFilterSheet() {
  const entries = pricesState.entries;
  const categories = [...new Set(entries.map(e => e.itemId?.category).filter(Boolean))].sort();
  const stores = [...new Map(entries.map(e => [String(e.storeId?._id || e.storeId), e.storeId?.name || 'Unknown'])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  const f = pricesState.filter;
  const catChips = categories.map(c =>
    `<button class="filter-chip${f.categories.includes(c) ? ' selected' : ''}" data-cat="${escapeAttr(c)}" onclick="togglePriceFilterCat(this)">${escapeHtml(c)}</button>`
  ).join('');
  const storeChips = stores.map(s =>
    `<button class="filter-chip${f.stores.includes(s.id) ? ' selected' : ''}" data-store="${escapeAttr(s.id)}" onclick="togglePriceFilterStore(this)">${escapeHtml(s.name)}</button>`
  ).join('');
  const dateOptions = [
    { val: 'all', label: 'All time' },
    { val: '7d', label: 'Last 7 days' },
    { val: '30d', label: 'Last 30 days' },
    { val: '90d', label: 'Last 3 months' }
  ];

  document.getElementById('filter-sheet-title').textContent = 'Filter & Sort';
  document.getElementById('filter-sheet-body').innerHTML = `
    <div>
      <div class="filter-section-label">Sort by</div>
      <div class="filter-chips">
        ${[['date','Date (newest)'],['name','Name A→Z'],['price','Price (lowest)'],['ppu','Price/unit (lowest)']].map(([v,l]) =>
          `<button class="filter-chip${f.sortBy===v?' selected':''}" onclick="setPriceFilterSort(this,'${v}')">${l}</button>`).join('')}
      </div>
    </div>
    <div>
      <div class="filter-section-label">Date range</div>
      <div class="filter-chips">
        ${dateOptions.map(o =>
          `<button class="filter-chip${f.dateRange===o.val?' selected':''}" onclick="setPriceFilterDate(this,'${o.val}')">${o.label}</button>`).join('')}
      </div>
    </div>
    ${categories.length ? `<div><div class="filter-section-label">Category</div><div class="filter-chips">${catChips}</div></div>` : ''}
    ${stores.length ? `<div><div class="filter-section-label">Store</div><div class="filter-chips">${storeChips}</div></div>` : ''}
    <div>
      <div class="filter-section-label">Show only</div>
      <div class="filter-toggle-row">
        <span>Organic only</span>
        <input type="checkbox" ${f.organicOnly ? 'checked' : ''} onchange="pricesState.filter.organicOnly=this.checked" />
      </div>
      <div class="filter-toggle-row">
        <span>On sale only</span>
        <input type="checkbox" ${f.saleOnly ? 'checked' : ''} onchange="pricesState.filter.saleOnly=this.checked" />
      </div>
    </div>`;

  document.getElementById('filter-sheet-clear').onclick = () => {
    pricesState.filter = { categories: [], stores: [], dateRange: 'all', organicOnly: false, saleOnly: false, sortBy: 'date' };
    closeFilterSheet();
    applyPricesFilter();
  };
  document.getElementById('filter-sheet-done').onclick = () => { closeFilterSheet(); applyPricesFilter(); };
  document.getElementById('filter-sheet-overlay').style.display = 'flex';
  document.getElementById('filter-sheet-overlay').onclick = (e) => {
    if (e.target === document.getElementById('filter-sheet-overlay')) { closeFilterSheet(); applyPricesFilter(); }
  };
}

function closeFilterSheet() {
  document.getElementById('filter-sheet-overlay').style.display = 'none';
}

function togglePriceFilterCat(btn) {
  const cat = btn.dataset.cat;
  const f = pricesState.filter;
  if (f.categories.includes(cat)) { f.categories = f.categories.filter(c => c !== cat); btn.classList.remove('selected'); }
  else { f.categories.push(cat); btn.classList.add('selected'); }
}
function togglePriceFilterStore(btn) {
  const storeId = btn.dataset.store;
  const f = pricesState.filter;
  if (f.stores.includes(storeId)) { f.stores = f.stores.filter(s => s !== storeId); btn.classList.remove('selected'); }
  else { f.stores.push(storeId); btn.classList.add('selected'); }
}
function setPriceFilterSort(btn, val) {
  pricesState.filter.sortBy = val;
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}
function setPriceFilterDate(btn, val) {
  pricesState.filter.dateRange = val;
  btn.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function openItemDetail(itemId, itemName) {
  const panel = document.getElementById('item-detail-panel');
  document.getElementById('detail-item-name').textContent = itemName;
  panel.style.display = 'block';
  panel.classList.add('open');

  // "View in Catalog" link — only show for admins
  const catalogLink = document.getElementById('btn-view-in-catalog');
  if (catalogLink) {
    const isAdmin = window.appAuth?.isAdmin();
    catalogLink.style.display = isAdmin ? '' : 'none';
    catalogLink.onclick = () => navigateToCatalogItem(itemId, itemName);
  }

  await Promise.all([loadDetailHistory(itemId), loadDetailCompare(itemId)]);
}

// Opens the detail panel for a cluster (1 or more similar items).
function openClusterDetail(cluster) {
  const { canonical, members } = cluster;
  const canonicalId = canonical.item?._id || canonical.item;
  const canonicalName = canonical.item?.name || 'Item';

  if (members.length === 1) {
    openItemDetail(canonicalId, canonicalName);
    return;
  }

  const panel = document.getElementById('item-detail-panel');
  const nameEl = document.getElementById('detail-item-name');
  nameEl.innerHTML = `${escapeHtml(canonicalName)} <span class="badge badge-muted" style="font-size:0.7rem;vertical-align:middle">${members.length} variants</span>`;
  panel.style.display = 'block';
  panel.classList.add('open');

  // Reset to history tab
  document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.detail-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.detail-tab[data-detail="history"]')?.classList.add('active');
  document.getElementById('detail-history')?.classList.add('active');

  const catalogLink = document.getElementById('btn-view-in-catalog');
  if (catalogLink) {
    catalogLink.style.display = window.appAuth?.isAdmin() ? '' : 'none';
    catalogLink.onclick = () => navigateToCatalogItem(canonicalId, canonicalName);
  }

  const allItemIds = members.map(m => m.item?._id || m.item).filter(Boolean);
  loadClusterHistory(allItemIds, members);
  loadClusterCompare(allItemIds);
}

async function loadClusterHistory(itemIds, members) {
  const container = document.getElementById('detail-history');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const allHistories = await Promise.all(itemIds.map(id => api.prices.history(id)));
    const allEntries = allHistories.flat().sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!allEntries.length) { container.innerHTML = emptyState('📋', 'No price history yet.'); return; }

    // Map itemId → variant name for labelling
    const canonicalName = members.reduce((best, m) =>
      m.entries.length >= best.entries.length ? m : best, members[0]).item?.name || '';
    const itemNames = {};
    members.forEach(m => { itemNames[String(m.item?._id || m.item)] = m.item?.name || ''; });

    const approvedEntries = allEntries.filter(e => e.status === 'approved');
    const minPPU = approvedEntries.length ? Math.min(...approvedEntries.map(e => e.pricePerUnit)) : null;
    const unit = allEntries[0]?.itemId?.unit || 'unit';

    container.innerHTML = allEntries.map(e => {
      const isBest = minPPU !== null && e.status === 'approved' && Math.abs(e.pricePerUnit - minPPU) < 0.001;
      const isPending = e.status === 'pending';
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      const variantName = itemNames[String(e.itemId?._id || e.itemId)] || '';
      const variantLabel = variantName && variantName !== canonicalName
        ? `<div class="text-muted" style="font-size:var(--text-sm)">${escapeHtml(variantName)}</div>` : '';
      const statusBadge = isPending
        ? `<span class="badge badge-pending">Pending</span>`
        : isBest ? `<span class="badge badge-best">Best</span>` : '';
      const priceLine = hasSale || hasCoupon ? `
        <div class="price-breakdown">
          <span class="price-breakdown-reg">${formatCurrency(e.regularPrice)} reg</span>
          ${hasSale ? `<span class="price-breakdown-sale">→ ${formatCurrency(e.salePrice)} sale</span>` : ''}
          ${hasCoupon ? `<span class="price-breakdown-coupon">− ${formatCurrency(e.couponAmount)} coupon</span>` : ''}
        </div>` : '';
      return `
        <div class="card" style="margin-bottom:0.5rem;${isPending ? 'opacity:0.8;border-left:3px solid var(--warning)' : ''}">
          <div class="card-body">
            <div class="card-title">${escapeHtml(e.storeId?.name || 'Unknown')}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity}</div>
            ${variantLabel}
            <div style="margin-top:4px">${statusBadge}</div>
            ${priceLine}
          </div>
          <div class="card-meta">
            <div class="price-big ${isBest ? 'price-best' : ''}">${formatCurrency(e.finalPrice)}</div>
            <div class="price-unit">${formatPPU(e.pricePerUnit, unit)}</div>
          </div>
        </div>`;
    }).join('');

    loadDetailTrend(null, approvedEntries);
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load history.');
  }
}

async function loadClusterCompare(itemIds) {
  const container = document.getElementById('detail-compare');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
  try {
    const allCompares = await Promise.all(itemIds.map(id => api.prices.compare(id)));
    const allEntries = allCompares.flat();

    if (!allEntries.length) { container.innerHTML = emptyState('🏪', 'No approved price comparisons yet.'); return; }

    // Best (lowest pricePerUnit) per store across all variants
    const byStore = {};
    allEntries.forEach(e => {
      const sid = String(e.storeId || '');
      if (!byStore[sid] || e.pricePerUnit < byStore[sid].pricePerUnit) byStore[sid] = e;
    });
    const storeEntries = Object.values(byStore).sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    const unit = storeEntries[0]?.item?.unit || 'unit';

    let callout = storeEntries.length > 1 ? buildCallout(storeEntries) : '';
    container.innerHTML = callout + storeEntries.map((e, i) => {
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      return `
        <div class="card" style="margin-bottom:0.5rem">
          <div class="card-body">
            <div class="card-title">${escapeHtml(e.store?.name || 'Unknown')}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity}</div>
            <div style="margin-top:4px">
              ${i === 0 ? `<span class="badge badge-best">⭐ Best price</span>` : ''}
              ${hasSale ? `<span class="badge badge-sale">🏷️ Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">✂️ Coupon</span>` : ''}
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

function navigateToCatalogItem(itemId, itemName) {
  window._catalogBackNav = { itemId, itemName };
  // Close detail panel
  const panel = document.getElementById('item-detail-panel');
  panel.classList.remove('open');
  setTimeout(() => { panel.style.display = 'none'; }, 250);
  // Navigate to More → Catalog, then open the specific item
  switchTab('more');
  showMoreSection('items');
  loadCatalog().then(() => {
    const item = catalogState?.items.find(i => i._id === itemId);
    if (item) {
      openEditItemModal(item._id, item.name, item.category, item.unit, !!item.isOrganic, item.brand || '', item.size);
    } else {
      // Item not in catalog yet — just scroll to card if present
      const card = document.querySelector(`[data-item-id="${itemId}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
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

      const organicBadge = e.itemId?.isOrganic ? `<span class="badge badge-organic">🌿 Organic</span> ` : '';
      const saleBadge = hasSale ? `<span class="badge badge-sale">🏷️ Sale</span> ` : '';
      const couponBadge = hasCoupon ? `<span class="badge badge-coupon">✂️ Coupon</span> ` : '';
      const canDelete = window.appAuth?.isAdmin() && !isPending;

      return `
        <div class="card" style="margin-bottom:0.5rem;${isPending ? 'opacity:0.8;border-left:3px solid var(--warning)' : ''}">
          <div class="card-body">
            <div class="card-title">${escapeHtml(e.storeId?.name || 'Unknown')}</div>
            <div class="card-subtitle">${formatDate(e.date)} &middot; qty ${e.quantity} &middot; by ${escapeHtml(e.submittedBy?.name || '—')}</div>
            <div style="margin-top:4px">${organicBadge}${saleBadge}${couponBadge}${statusBadge}</div>
            ${priceLine}
            ${e.notes ? `<div class="text-muted text-sm" style="margin-top:4px">${escapeHtml(e.notes)}</div>` : ''}
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
              ${i === 0 ? `<span class="badge badge-best">⭐ Best price</span>` : ''}
              ${hasSale ? `<span class="badge badge-sale">🏷️ Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">✂️ Coupon</span>` : ''}
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
    // Close detail panel and reload — handles both single-item and cluster views
    const panel = document.getElementById('item-detail-panel');
    panel.classList.remove('open');
    setTimeout(() => { panel.style.display = 'none'; }, 250);
    await loadPricesTab();
  } catch (err) {
    handleError(err, 'Failed to delete entry');
  }
}

// Live final-price calculator used in the add-price modal (debounced to avoid DOM churn on every keystroke)
let _recalcDebounce;
function recalcPricePreview() {
  clearTimeout(_recalcDebounce);
  _recalcDebounce = setTimeout(_doRecalcPricePreview, 150);
}
function _doRecalcPricePreview() {
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
  if (preview) {
    if (reg > 0) {
      preview.textContent = `Final: ${formatCurrency(final)} · ${formatPPU(ppu, document.getElementById('price-item-unit')?.value || 'unit')}`;
      preview.classList.remove('price-calc-placeholder');
    } else {
      preview.textContent = 'Enter a price above to see the final calculation';
      preview.classList.add('price-calc-placeholder');
    }
  }
}

function openAddPriceModal(prefillItem, onSaved) {
  const isAdmin = window.appAuth?.isAdmin();
  const submitLabel = isAdmin ? 'Save Entry' : 'Submit for Review';
  const bodyHTML = `
    <form id="add-price-form">
      <div class="form-group">
        <label>Item <span class="required-star">*</span></label>
        <div class="autocomplete-wrap" style="display:flex;gap:0.375rem;align-items:flex-start">
          <div style="flex:1;position:relative">
            <input class="form-control" id="price-item-input" placeholder="Search or create item..." autocomplete="off"
              value="${prefillItem ? escapeAttr(prefillItem.name) : ''}" required />
            <div class="autocomplete-dropdown" id="price-item-dropdown"></div>
          </div>
          ${window.appAuth?.features?.barcodeScanning ? `<button type="button" id="price-scan-btn" class="btn-icon" title="Scan barcode">&#9638;</button>` : ''}
        </div>
        <input type="hidden" id="price-item-id" value="${prefillItem ? escapeAttr(prefillItem._id) : ''}" />
        <input type="hidden" id="price-item-unit" value="${prefillItem ? escapeAttr(prefillItem.unit) : ''}" />
        <div id="price-item-context" class="item-context" style="display:${prefillItem ? '' : 'none'}">
          ${prefillItem ? `${formatItemMeta(prefillItem)}${prefillItem.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}` : ''}
        </div>
      </div>
      <div class="form-group">
        <label>Store <span class="required-star">*</span></label>
        <div class="autocomplete-wrap">
          <input class="form-control" id="price-store-input" placeholder="Search or add store..." autocomplete="off" required />
          <div class="autocomplete-dropdown" id="price-store-dropdown"></div>
        </div>
        <input type="hidden" id="price-store-id" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Regular Price ($) <span class="required-star">*</span></label>
          <input class="form-control" type="number" id="price-regular" step="0.01" min="0" required placeholder="0.00" />
        </div>
        <div class="form-group">
          <label>Quantity <span class="required-star">*</span></label>
          <input class="form-control" type="number" id="price-qty" step="any" min="0.01" value="1" required />
        </div>
      </div>
      <div class="form-group">
        <label>Date <span class="required-star">*</span></label>
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

      <div id="price-calc-preview" class="price-calc-preview price-calc-placeholder">Enter a price above to see the final calculation</div>

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
  registerDirtyForm(() => document.getElementById('add-price-form')?.requestSubmit());

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
      const ctx = document.getElementById('price-item-context');
      if (ctx) {
        ctx.innerHTML = `${formatItemMeta(item)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}`;
        ctx.style.display = '';
      }
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

  // Barcode scan button
  const priceScanBtn = document.getElementById('price-scan-btn');
  if (priceScanBtn) {
    priceScanBtn.addEventListener('click', () => {
      if (!window.BarcodeScanner) {
        showToast('Scanner unavailable. Try reloading the page.', 3000);
        return;
      }
      BarcodeScanner.open(async (upc) => {
        if (!upc) return;
        await handleBarcodeResult(upc, (item) => {
          itemInput.value = item.name;
          document.getElementById('price-item-id').value = item._id;
          document.getElementById('price-item-unit').value = item.unit || '';
          const ctx = document.getElementById('price-item-context');
          if (ctx) {
            ctx.innerHTML = `${formatItemMeta(item)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}`;
            ctx.style.display = '';
          }
          recalcPricePreview();
        });
      });
    });
  }

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
      const name = escapeHtml(e.itemId?.name || 'Unknown item');
      const unit = e.itemId?.unit || 'unit';
      const store = escapeHtml(e.storeId?.name || 'Unknown store');
      const submitter = escapeHtml(e.submittedBy?.name || 'Unknown');
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      const isOrganic = e.itemId?.isOrganic;
      return `
        <div class="pending-card" id="pending-${e._id}">
          <div class="pending-card-header">
            <div>
              <div style="font-weight:600">${name}${e.itemId?.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(e.itemId.brand) + ')</span>' : ''}${isOrganic ? ' <span class="badge badge-organic">🌿 Organic</span>' : ''}</div>
              <div class="text-muted text-sm">${e.itemId ? formatItemMeta(e.itemId) : ''} &middot; ${store} &middot; ${formatDate(e.date)} &middot; by ${submitter}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:1.1rem">${formatCurrency(e.finalPrice)}</div>
              <div class="text-muted text-sm">${formatPPU(e.pricePerUnit, escapeHtml(unit))}</div>
              ${hasSale ? `<span class="badge badge-sale">🏷️ Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">✂️ Coupon</span>` : ''}
            </div>
          </div>
          ${e.notes ? `<div class="text-muted text-sm">${escapeHtml(e.notes)}</div>` : ''}
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
            <input class="form-control" id="approve-coupon-code" value="${escapeAttr(entryRaw.couponCode || '')}" placeholder="e.g. Ibotta" />
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="form-control" type="date" id="approve-date" value="${new Date(entryRaw.date).toISOString().slice(0,10)}" />
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input class="form-control" id="approve-notes" value="${escapeAttr(entryRaw.notes || '')}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Approve</button>
      </div>
    </form>`;

  openModal('Edit & Approve', bodyHTML);
  registerDirtyForm(() => document.getElementById('approve-form')?.requestSubmit());

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
  document.getElementById('btn-prices-filter')?.addEventListener('click', openPricesFilterSheet);

  document.getElementById('price-search').addEventListener('input', (e) => {
    pricesState.searchQuery = e.target.value.toLowerCase();
    applyPricesFilter();
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
