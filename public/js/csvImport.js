// CSV Price Import — parser, importer, template download, and modal UI

const CSV_COLUMNS = ['item_name', 'brand', 'category', 'unit', 'size', 'store_name', 'regular_price',
  'sale_price', 'coupon_amount', 'coupon_code', 'quantity', 'date', 'notes', 'is_organic'];

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

function getCsvExampleRows() {
  const today = new Date().toISOString().slice(0, 10);
  // regular_price and sale_price are the TOTAL price for the stated quantity
  return [
    ['Whole Milk', 'Kirkland', 'Dairy', 'gal', '', 'Costco', '4.99', '', '', '', '1', today, '', 'false'],
    ['Avocado', '', 'Produce', 'each', '', 'Trader Joes', '2.37', '1.77', '', '', '3', today, '3 for $1.77 sale', 'false'],
    ['Black Beans', "Bush's Best", 'Pantry', 'oz', '28', 'Fred Meyer', '1.89', '', '', '', '1', today, '', 'false'],
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
    const regularPriceRaw = (row.regular_price || '').trim();

    if (!itemName) { errors.push({ row: rowNum, reason: 'item_name is required' }); continue; }
    if (!storeName) { errors.push({ row: rowNum, reason: 'store_name is required' }); continue; }
    if (!regularPriceRaw) { errors.push({ row: rowNum, reason: 'regular_price is required' }); continue; }

    const regularPrice = parseFloat(regularPriceRaw);
    if (isNaN(regularPrice) || regularPrice < 0) {
      errors.push({ row: rowNum, reason: `Invalid regular_price "${regularPriceRaw}"` }); continue;
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
    const salePrice = row.sale_price ? parseFloat(row.sale_price) : undefined;
    const couponAmount = row.coupon_amount ? parseFloat(row.coupon_amount) : undefined;
    const notes = (row.notes || '').trim() || undefined;
    const couponCode = (row.coupon_code || '').trim() || undefined;

    const payload = {
      itemId: item._id,
      storeId: store._id,
      regularPrice,
      date: rowDate.toISOString(),
      quantity: safeQty,
    };
    if (salePrice !== undefined && !isNaN(salePrice)) payload.salePrice = salePrice;
    if (couponAmount !== undefined && !isNaN(couponAmount)) payload.couponAmount = couponAmount;
    if (couponCode) payload.couponCode = couponCode;
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

/** Scan-tab CSV import (existing collapsible section) */
function handleCsvFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('csv-import-status');
  processCsvFile(file, statusEl);
  e.target.value = '';
}

/** Modal-based CSV import (from Prices header and More menu) */
function openCsvImportModal() {
  openModal('Import Prices from CSV', `
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      Import grocery prices from a spreadsheet. Each row becomes a price entry in your household's history.
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      <strong style="color:var(--text)">Required columns:</strong> item_name, category, unit, store_name, regular_price.
      Optional: brand, size, sale_price, coupon_amount, coupon_code, quantity, date, notes, is_organic.
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.5rem">
      Enter the <strong style="color:var(--text)">total price</strong> for regular_price and sale_price — e.g. $2.37 for 3 avocados with quantity 3. The per-unit price is calculated automatically.
      coupon_amount is a flat dollar discount (not per unit).
    </p>
    <p class="text-muted text-sm" style="margin-bottom:0.75rem">
      Duplicate entries (same item + store + date) are automatically skipped.
      New stores and items are created automatically.
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
