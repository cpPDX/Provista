// CSV Price Import — parser, importer, template download, and modal UI

const CSV_COLUMNS = [
  'item_name', 'brand', 'category', 'unit', 'size', 'store_name',
  'final_price', 'is_sale', 'quantity', 'date', 'notes', 'is_organic'
];

// Normalize raw CSV category names to canonical display names
const CATEGORY_NORMALIZE = {
  'dry': 'Pantry',
  'dry goods': 'Pantry',
  'dried goods': 'Pantry',
  'pantry dry': 'Pantry',
  'shelf stable': 'Pantry',
  'canned': 'Pantry',
  'canned goods': 'Pantry',
};

function normalizeCategory(raw) {
  if (!raw) return '';
  const key = raw.trim().toLowerCase();
  return CATEGORY_NORMALIZE[key] || raw.trim();
}

function parseBool(raw) {
  if (!raw) return false;
  return ['true', '1', 'yes'].includes(String(raw).trim().toLowerCase());
}

function getCsvExampleRows() {
  const today = new Date().toISOString().slice(0, 10);
  // final_price is the total you paid for the stated quantity
  return [
    ['Whole Milk', 'Kirkland', 'Dairy', 'gal', '', 'Costco', '4.99', 'false', '1', today, '', 'false'],
    ['Avocado', '', 'Produce', 'each', '', 'Trader Joes', '1.77', 'true', '3', today, '3 for $1.77 sale', 'false'],
    ['Black Beans', "Bush's Best", 'Pantry', 'oz', '28', 'Fred Meyer', '1.89', 'false', '1', today, '', 'false'],
  ];
}

/**
 * Parse CSV text into an array of row objects.
 * Handles quoted fields and basic CSV edge cases.
 */
function parseCsvPrices(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  function parseLine(line) {
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { fields.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    const row = { _rowNum: i + 1 };
    headers.forEach((h, idx) => { row[h] = fields[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a date string (YYYY-MM-DD or MM/DD/YYYY) to a Date object.
 * Returns today if blank or unparseable.
 */
function parseRowDate(raw) {
  if (!raw || !raw.trim()) return new Date();
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00');
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
    const [m, d, y] = v.split('/');
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00`);
  }
  return new Date();
}

/**
 * Import parsed CSV rows into the app.
 * All users can auto-create stores. Items require admin to auto-create.
 * Upserts duplicate entries (same item + store + date).
 * Returns { imported: N, errors: [{ row, reason }], newStores: [name], fuzzyMatched: [{ csv, matched }] }
 */

// Levenshtein distance for fuzzy item name matching
function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => j === 0 ? i : 0));
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Find an existing item by exact or fuzzy name match.
// Returns { item, fuzzy: true/false } or null.
function _findItem(csvName, itemMap) {
  const norm = csvName.toLowerCase().trim();
  if (itemMap.has(norm)) return { item: itemMap.get(norm), fuzzy: false };

  // Singular ↔ plural (strip/add trailing 's')
  const singular = norm.replace(/s$/, '');
  const plural = norm + 's';
  if (itemMap.has(singular)) return { item: itemMap.get(singular), fuzzy: true };
  if (itemMap.has(plural)) return { item: itemMap.get(plural), fuzzy: true };

  // Levenshtein ≤ 2 for names of 8+ characters (avoids false matches on short names)
  if (norm.length >= 8) {
    for (const [key, item] of itemMap) {
      if (Math.abs(key.length - norm.length) <= 3 && _levenshtein(key, norm) <= 2) {
        return { item, fuzzy: true };
      }
    }
  }

  return null;
}

// Returns { exact: item|null, fuzzy: [{item, score}] } — up to 3 candidates sorted by score.
function _findItemCandidates(csvName, itemMap) {
  const norm = csvName.toLowerCase().trim();
  if (itemMap.has(norm)) return { exact: itemMap.get(norm), fuzzy: [] };

  const singular = norm.replace(/s$/, '');
  const plural = norm + 's';
  if (itemMap.has(singular)) return { exact: null, fuzzy: [{ item: itemMap.get(singular), score: 1 }] };
  if (itemMap.has(plural)) return { exact: null, fuzzy: [{ item: itemMap.get(plural), score: 1 }] };

  if (norm.length >= 8) {
    const candidates = [];
    for (const [key, item] of itemMap) {
      if (Math.abs(key.length - norm.length) <= 3) {
        const score = _levenshtein(key, norm);
        if (score <= 2) candidates.push({ item, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return { exact: null, fuzzy: candidates.slice(0, 3) };
  }

  return { exact: null, fuzzy: [] };
}

// Annotate parsed rows with validation results and item/store match info.
// Returns array of enriched row objects; does NOT write anything to the DB.
function _annotateCsvRows(rows, itemMap, storeMap, canCreateItem) {
  return rows.map(row => {
    const errors = [];
    const warnings = [];
    const infos = [];

    const itemName = (row.item_name || '').trim();
    const storeName = (row.store_name || '').trim();
    const finalPriceRaw = (row.final_price || '').trim();

    if (!itemName) errors.push('item_name is required');
    if (!storeName) errors.push('store_name is required');

    let finalPrice = null;
    if (!finalPriceRaw) {
      errors.push('final_price is required');
    } else {
      finalPrice = parseFloat(finalPriceRaw);
      if (isNaN(finalPrice) || finalPrice < 0) {
        errors.push(`Invalid final_price "${finalPriceRaw}"`);
        finalPrice = null;
      }
    }

    let quantity = 1;
    if (row.quantity) {
      const q = parseFloat(row.quantity);
      if (isNaN(q) || q <= 0) warnings.push(`Invalid quantity "${row.quantity}" — defaulting to 1`);
      else quantity = q;
    }

    if (!row.category?.trim()) warnings.push('category is blank — will use "Other"');
    if (!row.unit?.trim()) warnings.push('unit is blank — will use "unit"');

    let itemMatch = null;
    let fuzzyCandidates = [];
    let newItem = false;

    if (itemName) {
      const result = _findItemCandidates(itemName, itemMap);
      if (result.exact) {
        itemMatch = result.exact;
      } else if (result.fuzzy.length > 0) {
        fuzzyCandidates = result.fuzzy;
      } else if (!canCreateItem) {
        errors.push(`"${itemName}" not in catalog — ask an admin to add it`);
      } else {
        newItem = true;
        infos.push(`"${itemName}" will be added to the catalog`);
      }
    }

    const storeMatch = storeName ? (storeMap.get(storeName.toLowerCase()) || null) : null;
    const newStore = !!storeName && !storeMatch;
    if (newStore) infos.push(`Store "${storeName}" will be created`);

    let status;
    if (errors.length > 0) status = 'error';
    else if (fuzzyCandidates.length > 0) status = 'fuzzy';
    else if (warnings.length > 0) status = 'warning';
    else status = 'ready';

    return {
      ...row,
      _errors: errors,
      _warnings: warnings,
      _infos: infos,
      _status: status,
      _skip: false,
      _itemMatch: itemMatch,
      _fuzzyCandidates: fuzzyCandidates,
      _fuzzyDecision: null, // null | 'existing' | 'new'
      _storeMatch: storeMatch,
      _newStore: newStore,
      _newItem: newItem,
      _finalPrice: finalPrice,
      _quantity: quantity,
      _isSale: parseBool(row.is_sale),
    };
  });
}

async function importCsvPrices(rows) {
  const auth = window.appAuth;
  const canCreateItem = auth.isAdmin();

  // Fetch existing items, stores, and prices once
  const [itemsData, storesData, existingPrices] = await Promise.all([
    api.items.list(),
    api.stores.list(),
    api.request('GET', '/prices')
  ]);

  const itemMap = new Map(itemsData.map(i => [i.name.toLowerCase(), i]));
  const storeMap = new Map(storesData.map(s => [s.name.toLowerCase(), s]));

  // Build dedup map: key -> existing entry _id (for upsert)
  const dupMap = new Map(existingPrices.map(p => [
    `${p.itemId._id || p.itemId}|${p.storeId._id || p.storeId}|${new Date(p.date).toDateString()}`,
    p._id
  ]));

  const imported = [];
  const errors = [];
  const newStores = [];
  const fuzzyMatched = [];

  for (const row of rows) {
    const rowNum = row._rowNum;

    const itemName = (row.item_name || '').trim();
    const storeName = (row.store_name || '').trim();
    const finalPriceRaw = (row.final_price || '').trim();

    if (!itemName) { errors.push({ row: rowNum, reason: 'item_name is required' }); continue; }
    if (!storeName) { errors.push({ row: rowNum, reason: 'store_name is required' }); continue; }
    if (!finalPriceRaw) { errors.push({ row: rowNum, reason: 'final_price is required' }); continue; }

    const regularPrice = parseFloat(finalPriceRaw);
    if (isNaN(regularPrice) || regularPrice < 0) {
      errors.push({ row: rowNum, reason: `Invalid final_price "${finalPriceRaw}"` }); continue;
    }

    // --- Resolve item (exact then fuzzy match, then create) ---
    let item;
    const match = _findItem(itemName, itemMap);
    if (match) {
      item = match.item;
      if (match.fuzzy) {
        fuzzyMatched.push({ csv: itemName, matched: item.name });
        itemMap.set(itemName.toLowerCase(), item); // cache so same name resolves instantly next row
      }
    } else {
      if (!canCreateItem) {
        errors.push({ row: rowNum, reason: `Item "${itemName}" not found. Ask an admin to add it first.` }); continue;
      }
      try {
        const category = normalizeCategory(row.category) || 'Other';
        const unit = (row.unit || '').trim() || 'unit';
        const brand = (row.brand || '').trim();
        const sizeRaw = parseFloat(row.size);
        const size = !isNaN(sizeRaw) && sizeRaw > 0 ? sizeRaw : null;
        const isOrganic = (row.is_organic || '').trim().toLowerCase() === 'true';
        item = await api.items.create({ name: itemName, brand, category, unit, size, isOrganic });
        itemMap.set(item.name.toLowerCase(), item);
      } catch (e) {
        errors.push({ row: rowNum, reason: `Could not create item "${itemName}": ${e.message}` }); continue;
      }
    }

    // --- Resolve store (all users can auto-create) ---
    let store = storeMap.get(storeName.toLowerCase());
    if (!store) {
      try {
        store = await api.stores.create({ name: storeName });
        storeMap.set(store.name.toLowerCase(), store);
        newStores.push(store.name);
      } catch (e) {
        errors.push({ row: rowNum, reason: `Could not create store "${storeName}": ${e.message}` }); continue;
      }
    }

    // --- Dedup / upsert check ---
    const rowDate = parseRowDate(row.date);
    const dupKey = `${item._id}|${store._id}|${rowDate.toDateString()}`;
    const existingId = dupMap.get(dupKey);
    dupMap.set(dupKey, null); // mark seen so the same row can't match twice

    // --- Build payload ---
    // regular_price and sale_price are the total price for the stated quantity
    // (matching the manual UI). The API calculates pricePerUnit = finalPrice / qty.
    const quantity = row.quantity ? parseFloat(row.quantity) : 1;
    const safeQty = isNaN(quantity) || quantity < 1 ? 1 : quantity;
    const isSale = parseBool(row.is_sale);
    const notes = (row.notes || '').trim() || undefined;

    const payload = {
      itemId: item._id,
      storeId: store._id,
      regularPrice,
      date: rowDate.toISOString(),
      quantity: safeQty,
      source: 'csv',
    };
    if (isSale) payload.salePrice = regularPrice;
    if (notes) payload.notes = notes;

    try {
      if (existingId) {
        // Replace existing entry: delete old and recreate with corrected values
        await api.prices.delete(existingId);
      }
      await api.prices.create(payload);
      imported.push(rowNum);
    } catch (e) {
      errors.push({ row: rowNum, reason: e.message });
    }
  }

  return { imported: imported.length, errors, newStores, fuzzyMatched };
}

// ===== Review sheet state (module-level, reset on each open) =====
let _csvRR = [];          // annotated rows
let _csvItemMap = null;
let _csvStoreMap = null;
let _csvCanCreate = false;
let _csvStatusEl = null;

function _csvRowsToImport() {
  return _csvRR.filter(r => !r._skip && r._status !== 'error' && !(r._status === 'fuzzy' && !r._fuzzyDecision));
}

function _csvBlockers() {
  return _csvRR.filter(r => !r._skip && (r._status === 'error' || (r._status === 'fuzzy' && !r._fuzzyDecision)));
}

function _csvBadgeClass(status) {
  return { ready: 'csv-badge-ready', warning: 'csv-badge-warning', fuzzy: 'csv-badge-fuzzy', error: 'csv-badge-error', skip: 'csv-badge-skip' }[status] || 'csv-badge-skip';
}

function _csvBadgeLabel(status) {
  return { ready: 'Ready', warning: 'Warning', fuzzy: 'Fuzzy Match', error: 'Error', skip: 'Skipped' }[status] || status;
}

function _renderCsvRowCard(row, idx) {
  const effectiveStatus = row._skip ? 'skip' : row._status;
  const itemName = (row.item_name || '').trim() || '(no name)';
  const storeName = (row.store_name || '').trim() || '(no store)';
  const priceStr = row.final_price ? `$${parseFloat(row.final_price).toFixed(2)}` : '—';
  const qtyStr = row._quantity > 1 ? ` × ${row._quantity}` : '';
  const dateStr = (row.date || '').trim();

  // Detail is always shown for error/fuzzy rows; collapsed for warning/info
  const alwaysOpen = !row._skip && (row._status === 'error' || row._status === 'fuzzy');
  const hasDetail = row._errors.length || row._warnings.length || row._infos.length || row._fuzzyCandidates.length;

  let detailHtml = '';
  if (!row._skip) {
    detailHtml += row._errors.map(e =>
      `<div class="csv-row-issue"><span style="color:var(--danger);flex-shrink:0">✕</span><span style="color:var(--danger)">${escapeHtml(e)}</span></div>`
    ).join('');
    detailHtml += row._warnings.map(w =>
      `<div class="csv-row-issue"><span style="color:#a16207;flex-shrink:0">!</span><span style="color:#a16207">${escapeHtml(w)}</span></div>`
    ).join('');
    detailHtml += row._infos.map(info =>
      `<div class="csv-row-issue"><span style="color:var(--text-muted);flex-shrink:0">ℹ</span><span style="color:var(--text-muted)">${escapeHtml(info)}</span></div>`
    ).join('');
    if (row._fuzzyCandidates.length) {
      detailHtml += `<div class="csv-fuzzy-label">Similar items found — choose one:</div>`;
      detailHtml += `<div class="csv-fuzzy-options">`;
      row._fuzzyCandidates.forEach((c, ci) => {
        const checked = row._fuzzyDecision === 'existing' && ci === 0 ? 'checked' : '';
        detailHtml += `<label class="csv-fuzzy-option">
          <input type="radio" name="csvfuzzy-${idx}" value="existing-${ci}" ${checked}>
          Use existing: <strong>${escapeHtml(c.item.name)}</strong>
        </label>`;
      });
      const checkedNew = row._fuzzyDecision === 'new' ? 'checked' : '';
      detailHtml += `<label class="csv-fuzzy-option">
        <input type="radio" name="csvfuzzy-${idx}" value="new" ${checkedNew}>
        Create new item: <strong>${escapeHtml(itemName)}</strong>
      </label>`;
      detailHtml += `</div>`;
    }
  }

  const skipLabel = row._skip ? 'Undo' : 'Skip';
  const chevron = hasDetail && !alwaysOpen ? `<span style="color:var(--text-muted);font-size:0.75rem;flex-shrink:0;padding:0.125rem" data-chevron="${idx}">▼</span>` : '';

  return `<div class="csv-row-card" data-idx="${idx}" data-status="${effectiveStatus}">
    <div class="csv-row-card-header" data-expand="${idx}">
      <div class="csv-row-info">
        <div class="csv-row-primary">
          <span class="csv-status-badge ${_csvBadgeClass(effectiveStatus)}">${_csvBadgeLabel(effectiveStatus)}</span>
          <strong style="font-size:0.9375rem">${escapeHtml(itemName)}</strong>
          <span class="text-muted" style="font-size:0.875rem">@ ${escapeHtml(storeName)}</span>
        </div>
        <div class="csv-row-secondary">${priceStr}${qtyStr}${dateStr ? ' · ' + escapeHtml(dateStr) : ''}</div>
      </div>
      <div class="csv-row-actions">
        <button class="csv-row-skip-btn" data-skip="${idx}">${escapeHtml(skipLabel)}</button>
        ${chevron}
      </div>
    </div>
    ${hasDetail ? `<div class="csv-row-detail" id="csv-row-detail-${idx}" style="${alwaysOpen ? '' : 'display:none'}">${detailHtml}</div>` : ''}
  </div>`;
}

function _updateCsvReviewUI() {
  const overlay = document.getElementById('csv-review-overlay');
  if (!overlay) return;

  overlay.querySelector('#csv-review-list').innerHTML = _csvRR.map((r, i) => _renderCsvRowCard(r, i)).join('');

  const counts = {};
  _csvRR.forEach(r => {
    const k = r._skip ? 'skip' : r._status;
    counts[k] = (counts[k] || 0) + 1;
  });
  const pills = [
    counts.ready    && `<span class="csv-summary-pill csv-badge-ready">${counts.ready} ready</span>`,
    counts.warning  && `<span class="csv-summary-pill csv-badge-warning">${counts.warning} warning${counts.warning !== 1 ? 's' : ''}</span>`,
    counts.fuzzy    && `<span class="csv-summary-pill csv-badge-fuzzy">${counts.fuzzy} fuzzy</span>`,
    counts.error    && `<span class="csv-summary-pill csv-badge-error">${counts.error} error${counts.error !== 1 ? 's' : ''}</span>`,
    counts.skip     && `<span class="csv-summary-pill csv-badge-skip">${counts.skip} skipped</span>`,
  ].filter(Boolean);
  overlay.querySelector('#csv-review-summary').innerHTML = pills.join('');

  const toImport = _csvRowsToImport().length;
  const blocked = _csvBlockers().length;
  const btn = overlay.querySelector('#csv-review-import-btn');
  btn.textContent = `Import ${toImport} row${toImport !== 1 ? 's' : ''}`;
  btn.disabled = blocked > 0 || toImport === 0;
}

function _handleCsvRowClick(e) {
  // Skip/undo toggle
  const skipBtn = e.target.closest('[data-skip]');
  if (skipBtn) {
    const idx = parseInt(skipBtn.dataset.skip, 10);
    _csvRR[idx]._skip = !_csvRR[idx]._skip;
    _updateCsvReviewUI();
    return;
  }
  // Expand/collapse detail (warning/info rows only)
  const header = e.target.closest('[data-expand]');
  if (header) {
    const idx = parseInt(header.dataset.expand, 10);
    const row = _csvRR[idx];
    if (row._status === 'error' || row._status === 'fuzzy') return; // always open
    const detail = document.getElementById(`csv-row-detail-${idx}`);
    const chevron = document.querySelector(`[data-chevron="${idx}"]`);
    if (detail) {
      const opening = detail.style.display === 'none';
      detail.style.display = opening ? '' : 'none';
      if (chevron) chevron.textContent = opening ? '▲' : '▼';
    }
  }
}

function _handleCsvRowChange(e) {
  const radio = e.target;
  if (radio.type !== 'radio' || !radio.name.startsWith('csvfuzzy-')) return;
  const idx = parseInt(radio.name.split('-')[1], 10);
  const val = radio.value;

  if (val === 'new') {
    _csvRR[idx]._fuzzyDecision = 'new';
    _csvRR[idx]._newItem = true;
    _csvRR[idx]._itemMatch = null;
  } else {
    const ci = parseInt(val.split('-')[1], 10);
    _csvRR[idx]._fuzzyDecision = 'existing';
    _csvRR[idx]._itemMatch = _csvRR[idx]._fuzzyCandidates[ci].item;
    _csvRR[idx]._newItem = false;
  }
  _csvRR[idx]._status = _csvRR[idx]._warnings.length > 0 ? 'warning' : 'ready';

  // Update only the badge and card status attr to avoid collapsing the detail
  const card = document.querySelector(`.csv-row-card[data-idx="${idx}"]`);
  if (card) {
    card.dataset.status = _csvRR[idx]._status;
    const badge = card.querySelector('.csv-status-badge');
    if (badge) {
      badge.className = `csv-status-badge ${_csvBadgeClass(_csvRR[idx]._status)}`;
      badge.textContent = _csvBadgeLabel(_csvRR[idx]._status);
    }
  }

  // Refresh summary + import button count only
  const counts = {};
  _csvRR.forEach(r => { const k = r._skip ? 'skip' : r._status; counts[k] = (counts[k] || 0) + 1; });
  const pills = [
    counts.ready    && `<span class="csv-summary-pill csv-badge-ready">${counts.ready} ready</span>`,
    counts.warning  && `<span class="csv-summary-pill csv-badge-warning">${counts.warning} warning${counts.warning !== 1 ? 's' : ''}</span>`,
    counts.fuzzy    && `<span class="csv-summary-pill csv-badge-fuzzy">${counts.fuzzy} fuzzy</span>`,
    counts.error    && `<span class="csv-summary-pill csv-badge-error">${counts.error} error${counts.error !== 1 ? 's' : ''}</span>`,
    counts.skip     && `<span class="csv-summary-pill csv-badge-skip">${counts.skip} skipped</span>`,
  ].filter(Boolean);
  const overlay = document.getElementById('csv-review-overlay');
  if (!overlay) return;
  overlay.querySelector('#csv-review-summary').innerHTML = pills.join('');
  const toImport = _csvRowsToImport().length;
  const blocked = _csvBlockers().length;
  const btn = overlay.querySelector('#csv-review-import-btn');
  btn.textContent = `Import ${toImport} row${toImport !== 1 ? 's' : ''}`;
  btn.disabled = blocked > 0 || toImport === 0;
}

function _closeCsvReview() {
  document.getElementById('csv-review-overlay')?.remove();
  _csvRR = []; _csvItemMap = null; _csvStoreMap = null; _csvStatusEl = null;
}

async function _startCsvImport() {
  const overlay = document.getElementById('csv-review-overlay');
  if (!overlay) return;

  const toImport = _csvRowsToImport();
  if (!toImport.length) return;

  // Lock the UI while writing
  overlay.querySelector('#csv-review-import-btn').disabled = true;
  overlay.querySelector('#csv-review-close-btn').disabled = true;
  overlay.querySelector('#csv-review-list').style.pointerEvents = 'none';

  const progressEl = overlay.querySelector('#csv-review-progress');
  progressEl.style.display = '';
  progressEl.innerHTML = `
    <div class="csv-progress-bar-wrap"><div class="csv-progress-bar" id="_csv-pb" style="width:0%"></div></div>
    <div id="_csv-pb-text" style="font-size:0.8125rem;color:var(--text-muted);text-align:center">Preparing…</div>`;

  // Fetch existing prices once for dedup (fail silently — dedup is best-effort)
  let dupMap = new Map();
  try {
    const existing = await api.request('GET', '/prices');
    existing.forEach(p => {
      const key = `${p.itemId._id || p.itemId}|${p.storeId._id || p.storeId}|${new Date(p.date).toDateString()}`;
      dupMap.set(key, p._id);
    });
  } catch (_) {}

  const itemMap = _csvItemMap;
  const storeMap = _csvStoreMap;
  const canCreate = _csvCanCreate;
  let imported = 0;
  const failedRows = [];

  for (let i = 0; i < toImport.length; i++) {
    const row = toImport[i];
    const pct = Math.round((i / toImport.length) * 100);
    document.getElementById('_csv-pb').style.width = pct + '%';
    document.getElementById('_csv-pb-text').textContent = `Writing ${i + 1} of ${toImport.length}…`;

    try {
      // Resolve item
      let item = row._itemMatch;
      if (!item && row._fuzzyDecision === 'existing' && row._fuzzyCandidates.length) {
        item = row._fuzzyCandidates[0].item;
        itemMap.set((row.item_name || '').toLowerCase(), item);
      }
      if (!item) {
        if (!canCreate) throw new Error(`"${row.item_name}" not in catalog`);
        const category = normalizeCategory(row.category) || 'Other';
        const newItemData = {
          name: (row.item_name || '').trim(),
          brand: (row.brand || '').trim(),
          category,
          unit: (row.unit || '').trim() || 'unit',
          isOrganic: parseBool(row.is_organic),
        };
        const sizeRaw = parseFloat(row.size);
        if (!isNaN(sizeRaw) && sizeRaw > 0) newItemData.size = sizeRaw;
        item = await api.items.create(newItemData);
        itemMap.set(item.name.toLowerCase(), item);
      }

      // Resolve store
      let store = row._storeMatch || storeMap.get((row.store_name || '').toLowerCase()) || null;
      if (!store) {
        store = await api.stores.create({ name: (row.store_name || '').trim() });
        storeMap.set(store.name.toLowerCase(), store);
      }

      // Dedup: replace existing entry for same item+store+date
      const rowDate = parseRowDate(row.date);
      const dupKey = `${item._id}|${store._id}|${rowDate.toDateString()}`;
      const existingId = dupMap.get(dupKey);
      dupMap.set(dupKey, null); // prevent same row from matching itself

      const payload = {
        itemId: item._id,
        storeId: store._id,
        regularPrice: row._finalPrice,
        date: rowDate.toISOString(),
        quantity: row._quantity,
        source: 'csv',
      };
      if (row._isSale) payload.salePrice = row._finalPrice;
      const notes = (row.notes || '').trim();
      if (notes) payload.notes = notes;

      if (existingId) await api.prices.delete(existingId);
      await api.prices.create(payload);
      imported++;
    } catch (e) {
      failedRows.push({ row: row._rowNum, reason: e.message });
    }
  }

  document.getElementById('_csv-pb').style.width = '100%';

  // Show result in the originating modal status element
  if (_csvStatusEl) {
    renderCsvImportResult({ imported, errors: failedRows, newStores: [], fuzzyMatched: [] }, _csvStatusEl);
  }

  // Show done state in the sheet footer
  const failed = failedRows.length;
  progressEl.innerHTML = `<p style="text-align:center;font-size:0.9375rem;margin:0">
    ${imported > 0 ? `<span style="color:var(--success)">✓ ${imported} price${imported !== 1 ? 's' : ''} imported</span>` : ''}
    ${failed > 0 ? `<span style="color:var(--danger)"> · ${failed} failed</span>` : ''}
  </p>`;

  const closeBtn = overlay.querySelector('#csv-review-close-btn');
  closeBtn.disabled = false;
  overlay.querySelector('#csv-review-import-btn').style.display = 'none';

  if (typeof loadPricesTab === 'function') loadPricesTab().catch(() => {});
}

function openCsvReviewSheet(annotatedRows, itemMap, storeMap, canCreateItem, statusEl) {
  _csvRR = annotatedRows;
  _csvItemMap = itemMap;
  _csvStoreMap = storeMap;
  _csvCanCreate = canCreateItem;
  _csvStatusEl = statusEl;

  document.getElementById('csv-review-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'csv-review-overlay';
  overlay.className = 'csv-review-overlay';
  overlay.innerHTML = `
    <div class="csv-review-sheet">
      <div class="csv-review-header">
        <div class="csv-review-title-row">
          <span class="csv-review-title">Review Import (${annotatedRows.length} row${annotatedRows.length !== 1 ? 's' : ''})</span>
          <button id="csv-review-close-btn" style="background:none;border:none;font-size:1.25rem;cursor:pointer;color:var(--text-muted);padding:0.25rem;line-height:1">&#x2715;</button>
        </div>
        <div id="csv-review-summary" class="csv-review-summary"></div>
      </div>
      <div id="csv-review-list" class="csv-review-body"></div>
      <div class="csv-review-footer" id="csv-review-footer">
        <div id="csv-review-progress" style="display:none;margin-bottom:0.75rem"></div>
        <button id="csv-review-import-btn" class="btn btn-primary btn-full" disabled>Import</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) _closeCsvReview(); });
  overlay.querySelector('#csv-review-close-btn').addEventListener('click', _closeCsvReview);
  overlay.querySelector('#csv-review-import-btn').addEventListener('click', _startCsvImport);
  overlay.querySelector('#csv-review-list').addEventListener('click', _handleCsvRowClick);
  overlay.querySelector('#csv-review-list').addEventListener('change', _handleCsvRowChange);

  _updateCsvReviewUI();
}

/**
 * Generate and download the CSV template file.
 */
function downloadCsvTemplate() {
  const escape = (val) => {
    const s = String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [
    CSV_COLUMNS.join(','),
    ...getCsvExampleRows().map(row => row.map(escape).join(','))
  ];

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grocery_prices_template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Handle CSV file input change — reads, parses, imports, shows summary.
 * statusEl: DOM element to render results into.
 */
const CSV_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function processCsvFile(file, statusEl) {
  if (!file) return;
  if (file.size > CSV_MAX_FILE_SIZE) {
    statusEl.innerHTML = '<p class="csv-import-error">File is too large (max 10 MB). Please split it into smaller files.</p>';
    return;
  }
  statusEl.innerHTML = '<p class="text-muted text-sm">Importing…</p>';
  try {
    const text = await file.text();
    const rows = parseCsvPrices(text);
    if (!rows.length) {
      statusEl.innerHTML = '<p class="csv-import-error">No data rows found. Make sure the file has a header row and at least one data row.</p>';
      return;
    }
    const result = await importCsvPrices(rows);
    renderCsvImportResult(result, statusEl);
  } catch (e) {
    statusEl.innerHTML = `<p class="csv-import-error">Import failed: ${e.message}</p>`;
  }
}

function renderCsvImportResult(result, statusEl) {
  let html = '';
  if (result.imported > 0) {
    html += `<p class="csv-import-success">✓ Imported ${result.imported} price${result.imported !== 1 ? 's' : ''}.`;
    if (result.newStores && result.newStores.length > 0) {
      html += ` ${result.newStores.length} new store${result.newStores.length !== 1 ? 's' : ''} created (${result.newStores.join(', ')}).`;
    }
    html += '</p>';
  } else {
    html += '<p class="csv-import-error">No prices imported.</p>';
  }
  if (result.fuzzyMatched && result.fuzzyMatched.length > 0) {
    html += `<details class="csv-import-result"><summary class="text-muted text-sm">${result.fuzzyMatched.length} name${result.fuzzyMatched.length !== 1 ? 's' : ''} auto-matched</summary>`;
    html += result.fuzzyMatched.map(f => `<p class="text-muted text-sm">"${escapeHtml(f.csv)}" → "${escapeHtml(f.matched)}"</p>`).join('');
    html += '</details>';
  }
  if (result.errors.length > 0) {
    html += `<details class="csv-import-result"><summary class="csv-import-error">${result.errors.length} row${result.errors.length !== 1 ? 's' : ''} skipped</summary>`;
    html += result.errors.map(e => `<p class="csv-import-error text-sm">Row ${e.row}: ${e.reason}</p>`).join('');
    html += '</details>';
  }
  statusEl.innerHTML = html;
}

/** Modal-based CSV import (from Prices header and More menu) */
function openCsvImportModal() {
  openModal('Import Prices from CSV', `
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      Import grocery prices from a spreadsheet. Each row becomes a price entry in your household's history.
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      <strong style="color:var(--text)">Required columns:</strong> item_name, category, unit, store_name, final_price.
      Optional: brand, size, is_sale, quantity, date, notes, is_organic.
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      <strong style="color:var(--text)">final_price</strong> is the total you paid for the stated quantity — e.g. $1.77 for 3 avocados with quantity 3.
      Set <strong style="color:var(--text)">is_sale</strong> to <code>true</code> if the item was discounted. The per-unit price is calculated automatically.
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.75rem">
      Duplicate entries (same item + store + date) are replaced.
      New stores and catalog items are created automatically.
      <button onclick="downloadCsvTemplate()" class="btn-link" style="color:var(--primary)">Download template →</button>
    </p>
    <input type="file" id="csv-modal-file-input" accept=".csv,text/csv" style="display:none" />
    <button class="btn btn-outline btn-full" id="btn-csv-modal-upload">Choose CSV File</button>
    <div id="csv-modal-status" style="margin-top:0.75rem"></div>
  `);

  document.getElementById('btn-csv-modal-upload').addEventListener('click', () => {
    document.getElementById('csv-modal-file-input').click();
  });

  document.getElementById('csv-modal-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('csv-modal-status');
    processCsvFile(file, statusEl);
    e.target.value = '';
  });
}
