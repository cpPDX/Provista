// CSV Price Import — parser, importer, and template download

const CSV_COLUMNS = ['item_name', 'store_name', 'regular_price', 'sale_price', 'coupon_amount', 'coupon_code', 'quantity', 'date', 'notes'];

const CSV_EXAMPLE_ROWS = [
  ['Whole Milk 1gal', 'Costco', '4.99', '', '', '', '1', '2026-04-01', ''],
  ['Sourdough Bread', 'Trader Joes', '3.49', '2.99', '0.50', 'Ibotta', '2', '2026-04-01', 'On sale this week'],
];

/**
 * Parse CSV text into an array of row objects.
 * Handles quoted fields and basic CSV edge cases.
 * Returns [{ item_name, store_name, regular_price, sale_price, coupon_amount, coupon_code, quantity, date, notes, _rowNum }]
 */
function parseCsvPrices(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // Parse a single CSV line respecting quoted fields
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

  // Normalize header names
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
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00');
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
    const [m, d, y] = v.split('/');
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00`);
  }
  return new Date();
}

/**
 * Import parsed CSV rows into the app.
 * Admin/owner can create missing items and stores; members get a row error instead.
 * Returns { imported: N, errors: [{ row, reason }] }
 */
async function importCsvPrices(rows) {
  const auth = window.appAuth;
  const canCreate = auth.isAdmin();

  // Fetch existing items and stores once
  const [itemsData, storesData] = await Promise.all([
    api.items.list(),
    api.stores.list()
  ]);

  // Build lookup maps (lower-cased name → object)
  const itemMap = new Map(itemsData.map(i => [i.name.toLowerCase(), i]));
  const storeMap = new Map(storesData.map(s => [s.name.toLowerCase(), s]));

  const imported = [];
  const errors = [];

  for (const row of rows) {
    const rowNum = row._rowNum;

    // --- Validate required fields ---
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
      if (!canCreate) {
        errors.push({ row: rowNum, reason: `Item "${itemName}" not found. Ask an admin to add it first.` }); continue;
      }
      try {
        item = await api.items.create({ name: itemName });
        itemMap.set(item.name.toLowerCase(), item);
      } catch (e) {
        errors.push({ row: rowNum, reason: `Could not create item "${itemName}": ${e.message}` }); continue;
      }
    }

    // --- Resolve store ---
    let store = storeMap.get(storeName.toLowerCase());
    if (!store) {
      if (!canCreate) {
        errors.push({ row: rowNum, reason: `Store "${storeName}" not found. Ask an admin to add it first.` }); continue;
      }
      try {
        store = await api.stores.create({ name: storeName });
        storeMap.set(store.name.toLowerCase(), store);
      } catch (e) {
        errors.push({ row: rowNum, reason: `Could not create store "${storeName}": ${e.message}` }); continue;
      }
    }

    // --- Build price payload ---
    const salePrice = row.sale_price ? parseFloat(row.sale_price) : undefined;
    const couponAmount = row.coupon_amount ? parseFloat(row.coupon_amount) : undefined;
    const quantity = row.quantity ? parseInt(row.quantity, 10) : 1;
    const date = parseRowDate(row.date);
    const notes = (row.notes || '').trim() || undefined;
    const couponCode = (row.coupon_code || '').trim() || undefined;

    const payload = {
      itemId: item._id,
      storeId: store._id,
      regularPrice,
      date: date.toISOString(),
      quantity: isNaN(quantity) || quantity < 1 ? 1 : quantity,
    };
    if (salePrice !== undefined && !isNaN(salePrice)) payload.salePrice = salePrice;
    if (couponAmount !== undefined && !isNaN(couponAmount)) payload.couponAmount = couponAmount;
    if (couponCode) payload.couponCode = couponCode;
    if (notes) payload.notes = notes;

    // --- Submit ---
    try {
      await api.prices.create(payload);
      imported.push(rowNum);
    } catch (e) {
      errors.push({ row: rowNum, reason: e.message });
    }
  }

  return { imported: imported.length, errors };
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
