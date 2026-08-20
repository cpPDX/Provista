// CSV import write-path enhancement.
// csvImport.js still owns parsing, validation, fuzzy review, and presentation.
// This file replaces only the final write loop so each reviewed row uses the
// same atomic item + store + price endpoint as manual grocery entry.
(function initUnifiedCsvImportWriter() {
  if (typeof _startCsvImport !== 'function' || typeof _csvRowsToImport !== 'function') {
    console.error('CSV import enhancement loaded before csvImport.js');
    return;
  }

  _startCsvImport = async function startUnifiedCsvImport() {
    const overlay = document.getElementById('csv-review-overlay');
    if (!overlay) return;

    const toImport = _csvRowsToImport();
    if (!toImport.length) return;

    const importBtn = overlay.querySelector('#csv-review-import-btn');
    const closeBtn = overlay.querySelector('#csv-review-close-btn');
    const list = overlay.querySelector('#csv-review-list');
    importBtn.disabled = true;
    closeBtn.disabled = true;
    list.style.pointerEvents = 'none';

    const progressEl = overlay.querySelector('#csv-review-progress');
    progressEl.style.display = '';
    progressEl.innerHTML = `
      <div class="csv-progress-bar-wrap"><div class="csv-progress-bar" id="_csv-pb" style="width:0%"></div></div>
      <div id="_csv-pb-text" style="font-size:0.8125rem;color:var(--text-muted);text-align:center">Preparing…</div>`;

    // Existing-price detection remains best-effort. Admin imports replace a same
    // item/store/day entry only after the new row is safely written server-side.
    const dupMap = new Map();
    try {
      const existing = await api.prices.list();
      existing.forEach(price => {
        const itemId = price.itemId?._id || price.itemId;
        const storeId = price.storeId?._id || price.storeId;
        const key = `${itemId}|${storeId}|${new Date(price.date).toDateString()}`;
        dupMap.set(key, price._id);
      });
    } catch (_) {}

    const itemMap = _csvItemMap;
    const storeMap = _csvStoreMap;
    const canCreateItem = _csvCanCreate;
    const canReplace = window.appAuth?.isAdmin();
    let imported = 0;
    let pending = 0;
    const failedRows = [];
    const newStores = [];
    const newItems = [];

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      const progress = Math.round((i / toImport.length) * 100);
      document.getElementById('_csv-pb').style.width = progress + '%';
      document.getElementById('_csv-pb-text').textContent = `Saving ${i + 1} of ${toImport.length}…`;

      try {
        let item = row._itemMatch || null;
        if (!item && row._fuzzyDecision === 'existing' && row._fuzzyCandidates.length) {
          item = row._fuzzyCandidates[0].item;
        }

        let store = row._storeMatch || storeMap.get((row.store_name || '').toLowerCase()) || null;
        const rowDate = parseRowDate(row.date);

        const payload = {
          regularPrice: row._finalPrice,
          quantity: row._quantity,
          date: rowDate.toISOString(),
          source: 'csv'
        };
        if (row._isSale) payload.salePrice = row._finalPrice;
        const notes = (row.notes || '').trim();
        if (notes) payload.notes = notes;

        if (item) {
          payload.itemId = item._id;
        } else {
          if (!canCreateItem) throw new Error(`"${row.item_name}" not in catalog`);
          const newItem = {
            name: (row.item_name || '').trim(),
            brand: (row.brand || '').trim(),
            category: normalizeCategory(row.category) || 'Other',
            unit: (row.unit || '').trim() || 'unit',
            isOrganic: parseBool(row.is_organic)
          };
          const size = parseFloat(row.size);
          if (!isNaN(size) && size > 0) newItem.size = size;
          payload.item = newItem;
        }

        if (store) {
          payload.storeId = store._id;
        } else {
          payload.store = { name: (row.store_name || '').trim() };
        }

        if (item && store && canReplace) {
          const dupKey = `${item._id}|${store._id}|${rowDate.toDateString()}`;
          const existingId = dupMap.get(dupKey);
          if (existingId) payload.replacePriceEntryId = existingId;
        }

        const result = await api.grocery.log(payload);
        const savedItem = result.createdItem || result.entry?.itemId;
        const savedStore = result.createdStore || result.entry?.storeId;

        if (savedItem?._id) {
          itemMap.set(savedItem.name.toLowerCase(), savedItem);
          row._itemMatch = savedItem;
          if (result.createdItem) newItems.push(savedItem.name);
        }
        if (savedStore?._id) {
          storeMap.set(savedStore.name.toLowerCase(), savedStore);
          row._storeMatch = savedStore;
          if (result.createdStore) newStores.push(savedStore.name);
        }

        if (result.entry?._id && savedItem?._id && savedStore?._id) {
          const savedKey = `${savedItem._id}|${savedStore._id}|${new Date(result.entry.date).toDateString()}`;
          dupMap.set(savedKey, result.entry._id);
        }

        imported += 1;
        if (result.entry?.status === 'pending') pending += 1;
      } catch (err) {
        failedRows.push({ row: row._rowNum, reason: err.message });
      }
    }

    document.getElementById('_csv-pb').style.width = '100%';

    if (_csvStatusEl) {
      renderCsvImportResult({
        imported,
        errors: failedRows,
        newStores: [...new Set(newStores)],
        fuzzyMatched: []
      }, _csvStatusEl);
      if (newItems.length) {
        const note = document.createElement('div');
        note.className = 'text-muted text-sm';
        note.style.marginTop = '0.5rem';
        note.textContent = `Added ${[...new Set(newItems)].length} new catalog item${[...new Set(newItems)].length === 1 ? '' : 's'}.`;
        _csvStatusEl.appendChild(note);
      }
    }

    const failed = failedRows.length;
    const pendingText = pending ? ` · ${pending} pending review` : '';
    progressEl.innerHTML = `<p style="text-align:center;font-size:0.9375rem;margin:0">
      ${imported > 0 ? `<span style="color:var(--success)">✓ ${imported} row${imported !== 1 ? 's' : ''} saved${pendingText}</span>` : ''}
      ${failed > 0 ? `<span style="color:var(--danger)"> · ${failed} failed</span>` : ''}
    </p>`;

    closeBtn.disabled = false;
    importBtn.style.display = 'none';
    if (typeof loadPricesTab === 'function') loadPricesTab().catch(() => {});
  };
})();
