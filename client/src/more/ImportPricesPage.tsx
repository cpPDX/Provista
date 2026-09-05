import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../shell/ToastProvider';
import {
  loadInsightItems,
  loadInsightStores,
  recordPrice,
  type InsightItem,
  type InsightStore,
  type RecordPriceInput
} from './insightsApi';
import {
  buildCsvPriceTemplate,
  levenshteinDistance,
  normalizeCsvCategory,
  normalizeCsvDate,
  parseCsvBoolean,
  parseCsvPrices,
  type CsvPriceRow
} from './csvPrices';
import './more.css';
import './importPrices.css';

interface FuzzyCandidate {
  id: string;
  name: string;
}

interface ReviewedCsvRow extends CsvPriceRow {
  errors: string[];
  warnings: string[];
  infos: string[];
  exactItemId: string | null;
  fuzzyCandidates: FuzzyCandidate[];
  fuzzyDecision: string;
  storeId: string | null;
  finalPriceValue: number | null;
  quantityValue: number;
  normalizedDate: string;
  isSaleValue: boolean;
  skip: boolean;
}

interface ImportFailure {
  row: number;
  reason: string;
}

interface ImportResult {
  saved: number;
  pending: number;
  failed: ImportFailure[];
  newItems: string[];
  newStores: string[];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function candidateItems(name: string, items: InsightItem[]) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return { exact: null as InsightItem | null, fuzzy: [] as InsightItem[] };
  const itemMap = new Map(items.map(item => [item.name.trim().toLowerCase(), item]));
  const exact = itemMap.get(normalized) || null;
  if (exact) return { exact, fuzzy: [] as InsightItem[] };

  const singular = normalized.replace(/s$/, '');
  const plural = `${normalized}s`;
  const inflectionMatch = itemMap.get(singular) || itemMap.get(plural);
  if (inflectionMatch) return { exact: null, fuzzy: [inflectionMatch] };

  if (normalized.length < 8) return { exact: null, fuzzy: [] as InsightItem[] };
  const fuzzy = items
    .map(item => ({ item, score: levenshteinDistance(item.name.trim().toLowerCase(), normalized) }))
    .filter(({ item, score }) => Math.abs(item.name.trim().length - normalized.length) <= 3 && score <= 2)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ item }) => item);
  return { exact: null, fuzzy };
}

function reviewRows(rows: CsvPriceRow[], items: InsightItem[], stores: InsightStore[]): ReviewedCsvRow[] {
  const storeMap = new Map(stores.map(store => [store.name.trim().toLowerCase(), store]));

  return rows.map(row => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const infos: string[] = [];
    const itemName = row.item_name.trim();
    const storeName = row.store_name.trim();
    const priceRaw = row.final_price.trim();

    if (!itemName) errors.push('item_name is required');
    if (!storeName) errors.push('store_name is required');

    let finalPriceValue: number | null = null;
    if (!priceRaw) {
      errors.push('final_price is required');
    } else {
      const parsedPrice = Number(priceRaw);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) errors.push(`Invalid final_price "${priceRaw}"`);
      else finalPriceValue = parsedPrice;
    }

    let quantityValue = 1;
    if (row.quantity.trim()) {
      const parsedQuantity = Number(row.quantity);
      if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) warnings.push(`Invalid quantity "${row.quantity}" - defaulting to 1`);
      else quantityValue = parsedQuantity;
    }

    if (!row.category.trim()) warnings.push('category is blank - will use "Other"');
    if (!row.unit.trim()) warnings.push('unit is blank - will use "unit"');

    const matches = candidateItems(itemName, items);
    if (itemName && !matches.exact && matches.fuzzy.length === 0) infos.push(`"${itemName}" will be added to the catalog`);
    const storeMatch = storeName ? storeMap.get(storeName.toLowerCase()) || null : null;
    if (storeName && !storeMatch) infos.push(`Store "${storeName}" will be created`);

    return {
      ...row,
      errors,
      warnings,
      infos,
      exactItemId: matches.exact?._id || null,
      fuzzyCandidates: matches.fuzzy.map(item => ({ id: item._id, name: item.name })),
      fuzzyDecision: '',
      storeId: storeMatch?._id || null,
      finalPriceValue,
      quantityValue,
      normalizedDate: normalizeCsvDate(row.date),
      isSaleValue: parseCsvBoolean(row.is_sale),
      skip: false
    };
  });
}

function needsMatchDecision(row: ReviewedCsvRow) {
  return !row.exactItemId && row.fuzzyCandidates.length > 0 && !row.fuzzyDecision;
}

function canImportRow(row: ReviewedCsvRow) {
  return !row.skip && row.errors.length === 0 && !needsMatchDecision(row);
}

export function ImportPricesPage() {
  const navigate = useNavigate();
  const { isAdmin, session } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState<InsightItem[]>([]);
  const [stores, setStores] = useState<InsightStore[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ReviewedCsvRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const offline = Boolean(session?.offlineSession);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadInsightItems(), loadInsightStores()])
      .then(([itemRows, storeRows]) => {
        if (cancelled) return;
        setItems(itemRows);
        setStores(storeRows);
      })
      .catch(error => {
        if (!cancelled) showToast(errorMessage(error, 'Failed to load products and stores for import'), { tone: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => { cancelled = true; };
  }, [showToast]);

  const readyCount = useMemo(() => rows.filter(canImportRow).length, [rows]);
  const attentionCount = useMemo(() => rows.filter(row => !row.skip && !canImportRow(row)).length, [rows]);
  const skippedCount = useMemo(() => rows.filter(row => row.skip).length, [rows]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setResult(null);
    setFileError('');
    setRows([]);
    setFileName(file?.name || '');
    if (!file) return;

    try {
      const parsedRows = parseCsvPrices(await file.text());
      if (parsedRows.length === 0) {
        setFileError('No data rows were found. Keep the header row and add at least one price row.');
        return;
      }
      setRows(reviewRows(parsedRows, items, stores));
    } catch (error) {
      setFileError(errorMessage(error, 'Could not read this CSV file.'));
    }
  };

  const updateRow = (rowNumber: number, update: Partial<ReviewedCsvRow>) => {
    setRows(current => current.map(row => row._rowNum === rowNumber ? { ...row, ...update } : row));
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildCsvPriceTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'provista-price-import-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const importReadyRows = async () => {
    const importRows = rows.filter(canImportRow);
    if (!importRows.length || importing || offline) return;
    setImporting(true);
    setResult(null);

    const itemMap = new Map(items.map(item => [item.name.trim().toLowerCase(), item]));
    const itemById = new Map(items.map(item => [item._id, item]));
    const storeMap = new Map(stores.map(store => [store.name.trim().toLowerCase(), store]));
    const storeById = new Map(stores.map(store => [store._id, store]));
    const failed: ImportFailure[] = [];
    const newItems: string[] = [];
    const newStores: string[] = [];
    let saved = 0;
    let pending = 0;

    for (const row of importRows) {
      try {
        const itemKey = row.item_name.trim().toLowerCase();
        const storeKey = row.store_name.trim().toLowerCase();
        let item = row.exactItemId ? itemById.get(row.exactItemId) || null : itemMap.get(itemKey) || null;
        if (!item && row.fuzzyDecision && row.fuzzyDecision !== 'new') item = itemById.get(row.fuzzyDecision) || null;
        let store = row.storeId ? storeById.get(row.storeId) || null : storeMap.get(storeKey) || null;

        const size = Number(row.size);
        const input: RecordPriceInput = {
          ...(item
            ? { itemId: item._id }
            : {
              item: {
                name: row.item_name.trim(),
                brand: row.brand.trim(),
                category: normalizeCsvCategory(row.category) || 'Other',
                unit: row.unit.trim() || 'unit',
                ...(Number.isFinite(size) && size > 0 ? { size } : {}),
                isOrganic: parseCsvBoolean(row.is_organic)
              }
            }),
          ...(store ? { storeId: store._id } : { store: { name: row.store_name.trim() } }),
          regularPrice: row.finalPriceValue as number,
          salePrice: row.isSaleValue ? row.finalPriceValue : null,
          quantity: row.quantityValue,
          date: row.normalizedDate,
          notes: row.notes.trim() || null,
          source: 'csv',
          replaceSameDay: true
        };

        const savedResult = await recordPrice(input);
        const savedItem = savedResult.createdItem || (typeof savedResult.entry.itemId === 'string' ? null : savedResult.entry.itemId);
        const savedStore = savedResult.createdStore || (typeof savedResult.entry.storeId === 'string' ? null : savedResult.entry.storeId);
        if (savedItem?._id) {
          itemMap.set(savedItem.name.trim().toLowerCase(), savedItem);
          itemMap.set(itemKey, savedItem);
          itemById.set(savedItem._id, savedItem);
          if (savedResult.createdItem) newItems.push(savedItem.name);
        }
        if (savedStore?._id) {
          storeMap.set(savedStore.name.trim().toLowerCase(), savedStore);
          storeMap.set(storeKey, savedStore);
          storeById.set(savedStore._id, savedStore);
          store = savedStore;
          if (savedResult.createdStore) newStores.push(savedStore.name);
        }
        saved += 1;
        if (savedResult.entry.status === 'pending') pending += 1;
      } catch (error) {
        failed.push({ row: row._rowNum, reason: errorMessage(error, 'Import failed') });
      }
    }

    setImporting(false);
    setResult({
      saved,
      pending,
      failed,
      newItems: [...new Set(newItems)],
      newStores: [...new Set(newStores)]
    });
    if (saved > 0) showToast(`${saved} price row${saved === 1 ? '' : 's'} saved`, { tone: 'success' });
  };

  if (!isAdmin) {
    return (
      <section className="more-page" aria-labelledby="import-prices-title">
        <header className="more-subpage-heading">
          <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}><span aria-hidden="true">←</span> More</button>
          <p className="more-eyebrow">Household tools</p>
          <h1 id="import-prices-title">Import prices</h1>
        </header>
        <div className="more-settings-card"><strong>Admin access required.</strong><p>Household price imports can create catalog items and replace same-day price history, so only an owner or admin can run them.</p></div>
      </section>
    );
  }

  return (
    <section className="more-page" aria-labelledby="import-prices-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more')}><span aria-hidden="true">←</span> More</button>
        <p className="more-eyebrow">Household tools</p>
        <h1 id="import-prices-title">Import prices</h1>
        <p>Review a CSV before anything changes. Provista flags invalid rows and asks before using a fuzzy product match.</p>
      </header>

      {offline && <div className="more-settings-card" role="status"><strong>Reconnect to import prices.</strong><p>Your current household data stays available, but CSV import needs a live connection.</p></div>}

      <section className="more-settings-card" aria-labelledby="csv-template-title">
        <div><h2 id="csv-template-title">1. Prepare the file</h2><p>Use the Provista columns so products, stores, quantities, and dates can be reviewed before import.</p></div>
        <button type="button" className="shell-button shell-button-secondary" onClick={downloadTemplate}>Download CSV template</button>
      </section>

      <section className="more-settings-card" aria-labelledby="csv-upload-title">
        <div><h2 id="csv-upload-title">2. Choose a CSV</h2><p>Nothing is saved when you choose the file.</p></div>
        <label className="more-field">
          <span>CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={event => void handleFile(event)} disabled={loadingCatalog || offline} />
        </label>
        {loadingCatalog && <p className="text-muted" role="status">Loading household products and stores…</p>}
        {fileName && <p className="text-muted">Reviewing <strong>{fileName}</strong></p>}
        {fileError && <p className="more-inline-error" role="alert">{fileError}</p>}
      </section>

      {rows.length > 0 && (
        <section className="more-settings-card" aria-labelledby="csv-review-title">
          <div className="more-section-heading-row">
            <div><h2 id="csv-review-title">3. Review rows</h2><p>{readyCount} ready · {attentionCount} need attention{skippedCount ? ` · ${skippedCount} skipped` : ''}</p></div>
          </div>
          <div className="csv-review-list">
            {rows.map(row => {
              const needsDecision = needsMatchDecision(row);
              const status = row.skip ? 'Skipped' : row.errors.length ? 'Error' : needsDecision ? 'Choose match' : row.warnings.length ? 'Ready with warning' : 'Ready';
              return (
                <article className="csv-review-row" key={row._rowNum} data-status={status.toLowerCase().replace(/\s+/g, '-')}>
                  <div className="csv-review-row-heading">
                    <div><small>Row {row._rowNum}</small><strong>{row.item_name || 'Missing product'} · {row.store_name || 'Missing store'}</strong></div>
                    <span className="csv-status-chip">{status}</span>
                  </div>
                  <p className="csv-row-summary">{row.final_price ? `$${row.final_price}` : 'No price'} · qty {row.quantityValue} · {row.normalizedDate}</p>
                  {row.errors.map(message => <p className="more-inline-error" key={message}>{message}</p>)}
                  {row.warnings.map(message => <p className="csv-warning" key={message}>{message}</p>)}
                  {row.infos.map(message => <p className="text-muted" key={message}>{message}</p>)}
                  {row.fuzzyCandidates.length > 0 && !row.exactItemId && (
                    <label className="more-field csv-match-field">
                      <span>Match “{row.item_name}” to</span>
                      <select value={row.fuzzyDecision} onChange={event => updateRow(row._rowNum, { fuzzyDecision: event.target.value })} disabled={row.skip}>
                        <option value="">Choose a match</option>
                        {row.fuzzyCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                        <option value="new">Create “{row.item_name}” as a new product</option>
                      </select>
                    </label>
                  )}
                  <label className="more-check-row"><input type="checkbox" checked={row.skip} onChange={event => updateRow(row._rowNum, { skip: event.target.checked })} /><span>Skip this row</span></label>
                </article>
              );
            })}
          </div>
          <div className="csv-import-actions">
            <button type="button" className="shell-button shell-button-primary" onClick={() => void importReadyRows()} disabled={readyCount === 0 || importing || offline}>
              {importing ? 'Importing…' : `Import ${readyCount} ready row${readyCount === 1 ? '' : 's'}`}
            </button>
            {attentionCount > 0 && <small>{attentionCount} row{attentionCount === 1 ? '' : 's'} will not import until fixed, matched, or skipped.</small>}
          </div>
        </section>
      )}

      {result && (
        <section className="more-settings-card" aria-labelledby="csv-result-title">
          <div><h2 id="csv-result-title">Import result</h2><p><strong>{result.saved} row{result.saved === 1 ? '' : 's'} saved.</strong>{result.pending ? ` ${result.pending} pending household review.` : ''}</p></div>
          {result.newItems.length > 0 && <p>Added {result.newItems.length} new catalog item{result.newItems.length === 1 ? '' : 's'}: {result.newItems.join(', ')}.</p>}
          {result.newStores.length > 0 && <p>Added {result.newStores.length} new store{result.newStores.length === 1 ? '' : 's'}: {result.newStores.join(', ')}.</p>}
          {result.failed.length > 0 && <div><strong>{result.failed.length} row{result.failed.length === 1 ? '' : 's'} failed.</strong>{result.failed.map(failure => <p className="more-inline-error" key={`${failure.row}-${failure.reason}`}>Row {failure.row}: {failure.reason}</p>)}</div>}
          <button type="button" className="shell-button shell-button-secondary" onClick={() => navigate('/app/more/insights/prices')}>Open price history</button>
        </section>
      )}
    </section>
  );
}
