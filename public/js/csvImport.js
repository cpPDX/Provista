// CSV Price Import — parser, importer, template download, and modal UI

const CSV_COLUMNS = ['item_name', 'category', 'unit', 'store_name', 'regular_price',
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

const CSV_EXAMPLE_ROWS = [
  ['Whole Milk 1gal', 'Dairy', 'gal', 'Costco', '4.99', '', '', '', '1', '2026-04-01', '', 'false'],
  ['Sourdough Bread', 'Bakery', 'loaf', 'Trader Joes', '3.49', '2.99', '0.50', 'Ibotta', '2', '2026-04-01', 'On sale this week', 'false'],
  ['Organic Carrots', 'Produce', 'lb', 'Fred Meyer', '2.49', '', '', '', '1', '2026-04-01', '', 'true'],
];

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
 * Skips duplicate entries (same item + store + date).
 * Returns { imported: N, errors: [{ row, reason }], newStores: [name] }
 */
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

  // Build dedup set: itemId|storeId|dateString
  const dupSet = new Set(existingPrices.map(p =>
    `${p.itemId._id || p.itemId}|${p.storeId._id || p.storeId}|${new Date(p.date).toDateString()}`
  ));

  const imported = [];
  const errors = [];
  const newStores = [];

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

    // --- Resolve item ---
    let item = itemMap.get(itemName.toLowerCase());
    if (!item) {
      if (!canCreateItem) {
        errors.push({ row: rowNum, reason: `Item "${itemName}" not found. Ask an admin to add it first.` }); continue;
      }
      try {
        const category = normalizeCategory(row.category) || 'Other';
        const unit = (row.unit || '').trim() || 'unit';
        const isOrganic = (row.is_organic || '').trim().toLowerCase() === 'true';
        item = await api.items.create({ name: itemName, category, unit, isOrganic });
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

    // --- Dedup check ---
    const rowDate = parseRowDate(row.date);
    const dupKey = `${item._id}|${store._id}|${rowDate.toDateString()}`;
    if (dupSet.has(dupKey)) {
      errors.push({ row: rowNum, reason: `Duplicate: ${itemName} at ${storeName} on that date already exists — skipped` });
      continue;
    }
    dupSet.add(dupKey);

    // --- Build payload ---
    const salePrice = row.sale_price ? parseFloat(row.sale_price) : undefined;
    const couponAmount = row.coupon_amount ? parseFloat(row.coupon_amount) : undefined;
    const quantity = row.quantity ? parseInt(row.quantity, 10) : 1;
    const notes = (row.notes || '').trim() || undefined;
    const couponCode = (row.coupon_code || '').trim() || undefined;

    const payload = {
      itemId: item._id,
      storeId: store._id,
      regularPrice,
      date: rowDate.toISOString(),
      quantity: isNaN(quantity) || quantity < 1 ? 1 : quantity,
    };
    if (salePrice !== undefined && !isNaN(salePrice)) payload.salePrice = salePrice;
    if (couponAmount !== undefined && !isNaN(couponAmount)) payload.couponAmount = couponAmount;
    if (couponCode) payload.couponCode = couponCode;
    if (notes) payload.notes = notes;

    try {
      await api.prices.create(payload);
      imported.push(rowNum);
    } catch (e) {
      errors.push({ row: rowNum, reason: e.message });
    }
  }

  return { imported: imported.length, errors, newStores };
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
    ...CSV_EXAMPLE_ROWS.map(row => row.map(escape).join(','))
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
async function processCsvFile(file, statusEl) {
  if (!file) return;
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
      Optional: sale_price, coupon_amount, coupon_code, quantity, date, notes, is_organic.
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
