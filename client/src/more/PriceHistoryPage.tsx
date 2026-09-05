import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { BarcodeResolverDialog } from '../products/BarcodeResolverDialog';
import type { ProductRef } from '../products/types';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import {
  approvePrice,
  loadInsightItems,
  loadInsightStores,
  loadPendingPrices,
  loadPriceComparison,
  loadPrices,
  recordPrice,
  rejectPrice,
  type InsightItem,
  type InsightStore,
  type PriceEntryRecord
} from './insightsApi';
import './more.css';

const NEW_PRODUCT_VALUE = '__new_product__';
const NEW_STORE_VALUE = '__new_store__';

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthRange(month: string): Record<string, string> {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthNumber, 1, 0, 0, 0, 0);
  return { startDate: start.toISOString(), endDate: new Date(end.getTime() - 1).toISOString() };
}

function itemFrom(entry: PriceEntryRecord) {
  return typeof entry.itemId === 'string' ? entry.item ?? null : entry.itemId;
}

function storeFrom(entry: PriceEntryRecord) {
  return typeof entry.storeId === 'string' ? entry.store ?? null : entry.storeId;
}

function entityId(value: InsightItem | InsightStore | string) {
  return typeof value === 'string' ? value : value._id;
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function bestValue(entries: PriceEntryRecord[]) {
  const approved = entries
    .filter(entry => entry.status !== 'pending' && Number.isFinite(Number(entry.pricePerUnit)))
    .sort((left, right) => Number(left.pricePerUnit) - Number(right.pricePerUnit));
  if (approved.length < 2) return null;
  return { best: approved[0], next: approved[1] };
}

type SortMode = 'date' | 'name' | 'price' | 'ppu';

interface PendingEditDraft {
  entry: PriceEntryRecord;
  storeId: string;
  regularPrice: string;
  salePrice: string;
  couponAmount: string;
  couponCode: string;
  quantity: string;
  date: string;
  notes: string;
}

interface PendingEditFormProps {
  draft: PendingEditDraft;
  stores: InsightStore[];
  saving: boolean;
  onChange: (patch: Partial<PendingEditDraft>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}

function PendingEditForm({ draft, stores, saving, onChange, onCancel, onSubmit }: PendingEditFormProps) {
  const titleId = `pending-price-edit-${draft.entry._id}`;
  return (
    <form className="more-record-card" aria-labelledby={titleId} onSubmit={onSubmit}>
      <div>
        <h3 id={titleId}>Edit and approve {itemFrom(draft.entry)?.name || 'pending price'}</h3>
        <p className="more-muted">Correct only what needs attention, then approve the household entry.</p>
      </div>
      <div className="more-field-grid">
        <label className="more-field">
          <span>Store</span>
          <select value={draft.storeId} onChange={event => onChange({ storeId: event.target.value })} required disabled={saving}>
            <option value="">Choose store</option>
            {stores.map(store => <option key={store._id} value={store._id}>{store.name}{store.location ? ` - ${store.location}` : ''}</option>)}
          </select>
        </label>
        <label className="more-field">
          <span>Regular price</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.regularPrice} onChange={event => onChange({ regularPrice: event.target.value })} required disabled={saving} />
        </label>
        <label className="more-field">
          <span>Quantity</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.quantity} onChange={event => onChange({ quantity: event.target.value })} required disabled={saving} />
        </label>
        <label className="more-field">
          <span>Date</span>
          <input type="date" value={draft.date} onChange={event => onChange({ date: event.target.value })} required disabled={saving} />
        </label>
        <label className="more-field">
          <span>Sale price <small>(optional)</small></span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.salePrice} onChange={event => onChange({ salePrice: event.target.value })} disabled={saving} />
        </label>
        <label className="more-field">
          <span>Coupon amount <small>(optional)</small></span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={draft.couponAmount} onChange={event => onChange({ couponAmount: event.target.value })} disabled={saving} />
        </label>
        <label className="more-field">
          <span>Coupon code <small>(optional)</small></span>
          <input value={draft.couponCode} onChange={event => onChange({ couponCode: event.target.value })} disabled={saving} />
        </label>
        <label className="more-field">
          <span>Notes <small>(optional)</small></span>
          <input value={draft.notes} onChange={event => onChange({ notes: event.target.value })} disabled={saving} />
        </label>
      </div>
      <div className="more-inline-actions">
        <button type="button" className="shell-button shell-button-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="shell-button shell-button-primary" disabled={saving || !draft.storeId || !draft.regularPrice || !draft.quantity || !draft.date}>
          {saving ? 'Approving…' : 'Save and approve'}
        </button>
      </div>
    </form>
  );
}

export function PriceHistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, session } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const month = searchParams.get('month') || '';
  const drillCategory = searchParams.get('category') || '';
  const drillStoreId = searchParams.get('storeId') || '';
  const drillStoreName = searchParams.get('storeName') || '';

  const [entries, setEntries] = useState<PriceEntryRecord[]>([]);
  const [items, setItems] = useState<InsightItem[]>([]);
  const [stores, setStores] = useState<InsightStore[]>([]);
  const [pending, setPending] = useState<PriceEntryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(drillCategory);
  const [storeId, setStoreId] = useState(drillStoreId);
  const [organicOnly, setOrganicOnly] = useState(false);
  const [saleOnly, setSaleOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [showRecord, setShowRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [recordItemId, setRecordItemId] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductBrand, setNewProductBrand] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('Other');
  const [newProductUnit, setNewProductUnit] = useState('each');
  const [newProductSize, setNewProductSize] = useState('');
  const [newProductOrganic, setNewProductOrganic] = useState(false);
  const [recordStoreId, setRecordStoreId] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreLocation, setNewStoreLocation] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [date, setDate] = useState(localDateValue());
  const [salePrice, setSalePrice] = useState('');
  const [couponAmount, setCouponAmount] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingEdit, setPendingEdit] = useState<PendingEditDraft | null>(null);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [comparisons, setComparisons] = useState<Record<string, PriceEntryRecord[]>>({});
  const [comparisonLoading, setComparisonLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = month ? monthRange(month) : {};
    if (drillStoreId) params.storeId = drillStoreId;

    Promise.all([
      loadPrices(params),
      loadInsightItems(),
      loadInsightStores(),
      isAdmin ? loadPendingPrices() : Promise.resolve([] as PriceEntryRecord[])
    ])
      .then(([priceRows, itemRows, storeRows, pendingRows]) => {
        if (cancelled) return;
        setEntries(priceRows);
        setItems([...itemRows].sort((a, b) => a.name.localeCompare(b.name)));
        setStores([...storeRows].sort((a, b) => a.name.localeCompare(b.name)));
        setPending(pendingRows);
      })
      .catch(error => {
        if (!cancelled) showToast(errorMessage(error, 'Failed to load price history'), { tone: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [month, drillStoreId, isAdmin, showToast]);

  useEffect(() => {
    setCategory(drillCategory);
    setStoreId(drillStoreId);
    setSearch(drillStoreName && !drillStoreId ? drillStoreName : '');
  }, [drillCategory, drillStoreId, drillStoreName]);

  const categories = useMemo(() => [...new Set(entries.map(entry => itemFrom(entry)?.category).filter(Boolean) as string[])].sort(), [entries]);

  const visibleEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return entries.filter(entry => {
      const item = itemFrom(entry);
      const store = storeFrom(entry);
      if (category && item?.category !== category) return false;
      if (storeId && String(store?._id || entry.storeId) !== storeId) return false;
      if (organicOnly && !item?.isOrganic) return false;
      if (saleOnly && entry.salePrice == null) return false;
      if (normalizedSearch) {
        const haystack = `${item?.name || ''} ${item?.category || ''} ${store?.name || ''}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
  }, [entries, search, category, storeId, organicOnly, saleOnly]);

  const groups = useMemo(() => {
    const byItem = new Map<string, { item: InsightItem | null; entries: PriceEntryRecord[] }>();
    for (const entry of visibleEntries) {
      const item = itemFrom(entry);
      const id = item?._id || String(entry.itemId);
      const current = byItem.get(id) ?? { item, entries: [] as PriceEntryRecord[] };
      current.entries.push(entry);
      byItem.set(id, current);
    }
    const result = [...byItem.values()];
    if (sortMode === 'name') result.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''));
    if (sortMode === 'price') result.sort((a, b) => (a.entries[0]?.finalPrice || 0) - (b.entries[0]?.finalPrice || 0));
    if (sortMode === 'ppu') result.sort((a, b) => (a.entries[0]?.pricePerUnit || 0) - (b.entries[0]?.pricePerUnit || 0));
    return result;
  }, [visibleEntries, sortMode]);

  const filtersActive = Boolean(search || category || storeId || organicOnly || saleOnly || month);
  const creatingProduct = recordItemId === NEW_PRODUCT_VALUE;
  const creatingStore = recordStoreId === NEW_STORE_VALUE;
  const productReady = creatingProduct
    ? Boolean(newProductName.trim() && newProductCategory.trim() && newProductUnit.trim())
    : Boolean(recordItemId);
  const storeReady = creatingStore ? Boolean(newStoreName.trim()) : Boolean(recordStoreId);

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setStoreId('');
    setOrganicOnly(false);
    setSaleOnly(false);
    setSortMode('date');
    setSearchParams({});
  };

  const finalPreview = useMemo(() => {
    if (!regularPrice.trim()) return null;
    const regular = Number(regularPrice);
    const sale = salePrice ? Number(salePrice) : null;
    const coupon = couponAmount ? Number(couponAmount) : 0;
    const qty = Number(quantity) || 1;
    if (!Number.isFinite(regular) || regular < 0 || !Number.isFinite(qty) || qty <= 0) return null;
    const base = sale != null && Number.isFinite(sale) && sale < regular ? sale : regular;
    const final = Math.max(0, base - (Number.isFinite(coupon) ? coupon : 0));
    return { final, perUnit: final / qty };
  }, [regularPrice, salePrice, couponAmount, quantity]);

  const entryMatchesLoadedScope = (entry: PriceEntryRecord) => {
    if (month && entry.date.slice(0, 7) !== month) return false;
    if (drillStoreId && entityId(entry.storeId) !== drillStoreId) return false;
    return true;
  };

  const resetRecordForm = () => {
    setRecordItemId('');
    setNewProductName('');
    setNewProductBrand('');
    setNewProductCategory('Other');
    setNewProductUnit('each');
    setNewProductSize('');
    setNewProductOrganic(false);
    setRecordStoreId('');
    setNewStoreName('');
    setNewStoreLocation('');
    setRegularPrice('');
    setSalePrice('');
    setCouponAmount('');
    setCouponCode('');
    setNotes('');
    setQuantity('1');
    setDate(localDateValue());
  };

  const submitPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !productReady || !storeReady || !regularPrice) return;
    setSaving(true);
    try {
      const numericSize = newProductSize.trim() ? Number(newProductSize) : null;
      const result = await recordPrice({
        ...(creatingProduct
          ? {
              item: {
                name: newProductName.trim(),
                brand: newProductBrand.trim(),
                category: newProductCategory.trim(),
                unit: newProductUnit.trim(),
                ...(numericSize != null && Number.isFinite(numericSize) ? { size: numericSize } : {}),
                isOrganic: newProductOrganic
              }
            }
          : { itemId: recordItemId }),
        ...(creatingStore
          ? { store: { name: newStoreName.trim(), location: newStoreLocation.trim() } }
          : { storeId: recordStoreId }),
        regularPrice: Number(regularPrice),
        salePrice: salePrice ? Number(salePrice) : null,
        couponAmount: couponAmount ? Number(couponAmount) : null,
        couponCode: couponCode.trim() || null,
        quantity: Number(quantity) || 1,
        date,
        notes: notes.trim() || null,
        source: 'manual'
      });
      const created = result.entry;
      if (entryMatchesLoadedScope(created)) setEntries(current => [created, ...current]);
      if (result.createdItem) {
        setItems(current => [...current.filter(item => item._id !== result.createdItem?._id), result.createdItem as InsightItem].sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (result.createdStore) {
        setStores(current => [...current.filter(store => store._id !== result.createdStore?._id), result.createdStore as InsightStore].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setComparisons(current => {
        const next = { ...current };
        const itemId = itemFrom(created)?._id || (typeof created.itemId === 'string' ? created.itemId : created.itemId._id);
        delete next[itemId];
        return next;
      });
      showToast(created.status === 'pending' ? 'Price submitted for household review' : 'Price recorded', { tone: 'success' });
      setShowRecord(false);
      resetRecordForm();
    } catch (error) {
      showToast(errorMessage(error, 'Failed to record price'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleScannedProduct = async (product: ProductRef) => {
    const item: InsightItem = {
      _id: product._id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unit: product.unit,
      size: product.size,
      isOrganic: product.isOrganic
    };
    setItems(current => [...current.filter(entry => entry._id !== item._id), item].sort((a, b) => a.name.localeCompare(b.name)));
    setRecordItemId(item._id);
    setShowRecord(true);
    showToast(`${item.name} selected from barcode`, { tone: 'success' });
  };

  const approvePending = async (entry: PriceEntryRecord) => {
    try {
      const approved = await approvePrice(entry._id);
      setPending(current => current.filter(row => row._id !== entry._id));
      if (entryMatchesLoadedScope(approved)) setEntries(current => [approved, ...current.filter(row => row._id !== entry._id)]);
      showToast('Price approved', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to approve price'), { tone: 'error' });
    }
  };

  const startEditPending = (entry: PriceEntryRecord) => {
    setPendingEdit({
      entry,
      storeId: entityId(entry.storeId),
      regularPrice: String(entry.regularPrice),
      salePrice: entry.salePrice == null ? '' : String(entry.salePrice),
      couponAmount: entry.couponAmount == null ? '' : String(entry.couponAmount),
      couponCode: entry.couponCode || '',
      quantity: String(entry.quantity || 1),
      date: entry.date.slice(0, 10),
      notes: entry.notes || ''
    });
  };

  const submitPendingEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingEdit || pendingSaving) return;
    setPendingSaving(true);
    try {
      const approved = await approvePrice(pendingEdit.entry._id, {
        storeId: pendingEdit.storeId,
        regularPrice: Number(pendingEdit.regularPrice),
        salePrice: pendingEdit.salePrice ? Number(pendingEdit.salePrice) : null,
        couponAmount: pendingEdit.couponAmount ? Number(pendingEdit.couponAmount) : null,
        couponCode: pendingEdit.couponCode.trim() || null,
        quantity: Number(pendingEdit.quantity),
        date: pendingEdit.date,
        notes: pendingEdit.notes.trim() || null
      });
      setPending(current => current.filter(row => row._id !== approved._id));
      if (entryMatchesLoadedScope(approved)) setEntries(current => [approved, ...current.filter(row => row._id !== approved._id)]);
      setPendingEdit(null);
      showToast('Price corrected and approved', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to edit and approve price'), { tone: 'error' });
    } finally {
      setPendingSaving(false);
    }
  };

  const rejectPending = async (entry: PriceEntryRecord) => {
    const item = itemFrom(entry);
    const approved = await confirm({
      title: 'Reject this price?',
      message: `${item?.name || 'This price'} will be removed from the household review queue.`,
      confirmLabel: 'Reject price',
      cancelLabel: 'Keep price',
      danger: true
    });
    if (!approved) return;
    try {
      await rejectPrice(entry._id);
      setPending(current => current.filter(row => row._id !== entry._id));
      if (pendingEdit?.entry._id === entry._id) setPendingEdit(null);
      showToast('Price rejected', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to reject price'), { tone: 'error' });
    }
  };

  const ensureComparison = async (itemId: string) => {
    if (comparisons[itemId] || comparisonLoading[itemId]) return;
    setComparisonLoading(current => ({ ...current, [itemId]: true }));
    try {
      const rows = await loadPriceComparison(itemId);
      setComparisons(current => ({ ...current, [itemId]: rows }));
    } catch (error) {
      showToast(errorMessage(error, 'Failed to compare recent prices'), { tone: 'error' });
    } finally {
      setComparisonLoading(current => ({ ...current, [itemId]: false }));
    }
  };

  return (
    <section className="more-page" aria-labelledby="price-history-title">
      <header className="more-subpage-heading">
        <button type="button" className="more-back-button" onClick={() => navigate('/app/more/insights')}>
          <span aria-hidden="true">←</span> Insights
        </button>
        <p className="more-eyebrow">Household insights</p>
        <h1 id="price-history-title">Price history</h1>
        <p>{month ? `Showing purchases from ${month}.` : 'Household prices you paid or confirmed, with quick ways to narrow the history.'}</p>
      </header>

      <div className="more-insights-toolbar">
        <label className="more-field more-insights-search">
          <span>Search price history</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Product, category, or store" />
        </label>
        <button type="button" className="shell-button shell-button-primary" onClick={() => setShowRecord(current => !current)}>
          {showRecord ? 'Close price form' : 'Record price'}
        </button>
      </div>

      {showRecord && (
        <form className="more-settings-card" onSubmit={submitPrice} aria-labelledby="record-price-title">
          <div>
            <h2 id="record-price-title">Record household price</h2>
            <p>Choose what you bought, scan the package, or add the missing product or store without leaving this price entry.</p>
          </div>
          <div className="more-field-grid">
            <label className="more-field">
              <span>Product</span>
              <select value={recordItemId} onChange={event => setRecordItemId(event.target.value)} required>
                <option value="">Choose product</option>
                {items.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
                <option value={NEW_PRODUCT_VALUE}>Add a new product…</option>
              </select>
            </label>
            <label className="more-field">
              <span>Store</span>
              <select value={recordStoreId} onChange={event => setRecordStoreId(event.target.value)} required>
                <option value="">Choose store</option>
                {stores.map(store => <option key={store._id} value={store._id}>{store.name}{store.location ? ` - ${store.location}` : ''}</option>)}
                <option value={NEW_STORE_VALUE}>Add a new store…</option>
              </select>
            </label>
          </div>

          {session?.features.barcodeScanning && (
            <div className="more-inline-actions">
              <button type="button" className="shell-button shell-button-secondary" onClick={() => setScanOpen(true)}>
                Scan product barcode
              </button>
            </div>
          )}

          {creatingProduct && (
            <fieldset className="more-inline-create-group">
              <legend>New product</legend>
              <div className="more-field-grid">
                <label className="more-field"><span>Product name</span><input value={newProductName} onChange={event => setNewProductName(event.target.value)} required /></label>
                <label className="more-field"><span>Brand <small>(optional)</small></span><input value={newProductBrand} onChange={event => setNewProductBrand(event.target.value)} /></label>
                <label className="more-field"><span>Category</span><input value={newProductCategory} onChange={event => setNewProductCategory(event.target.value)} required /></label>
                <label className="more-field"><span>Unit</span><input value={newProductUnit} onChange={event => setNewProductUnit(event.target.value)} required /></label>
                <label className="more-field"><span>Package size <small>(optional)</small></span><input type="number" inputMode="decimal" min="0" step="any" value={newProductSize} onChange={event => setNewProductSize(event.target.value)} /></label>
                <label className="more-check-row"><input type="checkbox" checked={newProductOrganic} onChange={event => setNewProductOrganic(event.target.checked)} /><span>Organic</span></label>
              </div>
            </fieldset>
          )}

          {creatingStore && (
            <fieldset className="more-inline-create-group">
              <legend>New store</legend>
              <div className="more-field-grid">
                <label className="more-field"><span>Store name</span><input value={newStoreName} onChange={event => setNewStoreName(event.target.value)} required /></label>
                <label className="more-field"><span>Location <small>(optional)</small></span><input value={newStoreLocation} onChange={event => setNewStoreLocation(event.target.value)} /></label>
              </div>
            </fieldset>
          )}

          <div className="more-field-grid">
            <label className="more-field"><span>Regular price</span><input type="number" inputMode="decimal" min="0" step="0.01" value={regularPrice} onChange={event => setRegularPrice(event.target.value)} required /></label>
            <label className="more-field"><span>Quantity</span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
            <label className="more-field"><span>Date</span><input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
          </div>
          <details className="more-advanced-settings">
            <summary>Sale, coupon, or notes</summary>
            <div className="more-field-grid">
              <label className="more-field"><span>Sale price <small>(optional)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={salePrice} onChange={event => setSalePrice(event.target.value)} /></label>
              <label className="more-field"><span>Coupon amount <small>(optional)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={couponAmount} onChange={event => setCouponAmount(event.target.value)} /></label>
              <label className="more-field"><span>Coupon code <small>(optional)</small></span><input value={couponCode} onChange={event => setCouponCode(event.target.value)} /></label>
              <label className="more-field"><span>Notes <small>(optional)</small></span><input value={notes} onChange={event => setNotes(event.target.value)} /></label>
            </div>
          </details>
          {finalPreview && <div className="more-price-preview" role="status"><strong>{currency(finalPreview.final)}</strong><span>{currency(finalPreview.perUnit)} per unit</span></div>}
          <button type="submit" className="shell-button shell-button-primary" disabled={saving || !productReady || !storeReady || !regularPrice}>
            {saving ? 'Recording…' : 'Record price'}
          </button>
        </form>
      )}

      <details className="more-advanced-settings more-insights-filters" open={Boolean(category || storeId || organicOnly || saleOnly)}>
        <summary>Filter and sort</summary>
        <div className="more-field-grid">
          <label className="more-field"><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="more-field"><span>Store</span><select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">All stores</option>{stores.map(store => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>
          <label className="more-field"><span>Sort by</span><select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}><option value="date">Newest</option><option value="name">Name A-Z</option><option value="price">Lowest price</option><option value="ppu">Lowest price per unit</option></select></label>
        </div>
        <div className="more-inline-actions">
          <label className="more-check-row"><input type="checkbox" checked={organicOnly} onChange={event => setOrganicOnly(event.target.checked)} /><span>Organic only</span></label>
          <label className="more-check-row"><input type="checkbox" checked={saleOnly} onChange={event => setSaleOnly(event.target.checked)} /><span>On sale only</span></label>
        </div>
        {filtersActive && <button type="button" className="shell-button shell-button-secondary" onClick={clearFilters}>Clear filters</button>}
      </details>

      {isAdmin && pending.length > 0 && (
        <section className="more-settings-card" aria-labelledby="pending-prices-title">
          <div><h2 id="pending-prices-title">Prices awaiting review</h2><p>Approve household-submitted prices, or correct an exception without asking the shopper to re-enter it.</p></div>
          <div className="more-record-list">
            {pending.map(entry => {
              const item = itemFrom(entry);
              const store = storeFrom(entry);
              if (pendingEdit?.entry._id === entry._id) {
                return (
                  <PendingEditForm
                    key={entry._id}
                    draft={pendingEdit}
                    stores={stores}
                    saving={pendingSaving}
                    onChange={patch => setPendingEdit(current => current ? { ...current, ...patch } : current)}
                    onCancel={() => setPendingEdit(null)}
                    onSubmit={submitPendingEdit}
                  />
                );
              }
              return (
                <div className="more-record-card more-record-row" key={entry._id}>
                  <div>
                    <strong>{item?.name || 'Unknown product'} - {currency(entry.finalPrice)}</strong>
                    <small>{store?.name || 'Unknown store'} · {formatDate(entry.date)} · Qty {entry.quantity}</small>
                    {entry.notes && <small>{entry.notes}</small>}
                  </div>
                  <div className="more-inline-actions">
                    <button type="button" className="shell-button shell-button-secondary" onClick={() => startEditPending(entry)}>Edit &amp; Approve</button>
                    <button type="button" className="shell-button shell-button-primary" onClick={() => void approvePending(entry)}>Approve</button>
                    <button type="button" className="shell-button shell-button-secondary" onClick={() => void rejectPending(entry)}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="more-settings-card" aria-labelledby="price-results-title">
        <div className="more-section-heading-row"><div><h2 id="price-results-title">Household history</h2><p>{loading ? 'Loading prices…' : `${groups.length} product${groups.length === 1 ? '' : 's'} shown`}</p></div></div>
        {!loading && groups.length === 0 ? (
          <div className="more-empty-state">
            <strong>{entries.length === 0 ? 'No price history yet.' : 'No price history matches this view.'}</strong>
            <p>{entries.length === 0 ? 'Record the first price your household paid.' : 'Clear search or filters to get back to the household history.'}</p>
            <div className="more-inline-actions">{entries.length === 0 ? <button type="button" className="shell-button shell-button-primary" onClick={() => setShowRecord(true)}>Record price</button> : <button type="button" className="shell-button shell-button-primary" onClick={clearFilters}>Clear filters</button>}</div>
          </div>
        ) : (
          <div className="more-price-list">
            {groups.map(group => {
              const latest = group.entries[0];
              const store = storeFrom(latest);
              const itemId = group.item?._id || String(latest.itemId);
              const value = bestValue(comparisons[itemId] || []);
              const savings = value ? Math.max(0, Number(value.next.pricePerUnit) - Number(value.best.pricePerUnit)) : 0;
              return (
                <details
                  className="more-price-card"
                  key={itemId}
                  onToggle={event => {
                    if (event.currentTarget.open) void ensureComparison(itemId);
                  }}
                >
                  <summary>
                    <span><strong>{group.item?.name || 'Unknown product'}</strong><small>{store?.name || 'Unknown store'} · {formatDate(latest.date)}</small></span>
                    <span className="more-price-card-value"><strong>{currency(latest.finalPrice)}</strong><small>{currency(latest.pricePerUnit)} / {group.item?.unit || 'unit'}</small></span>
                  </summary>
                  <div className="more-price-history-rows">
                    {comparisonLoading[itemId] && <p className="more-muted" role="status">Comparing recent store prices…</p>}
                    {value && (
                      <div className="more-status-card">
                        <strong>Best recent value: {currency(value.best.pricePerUnit)} / {group.item?.unit || 'unit'} at {storeFrom(value.best)?.name || 'Unknown store'}</strong>
                        {savings > 0 && <span>Saves {currency(savings)} per {group.item?.unit || 'unit'} versus the next recent store price.</span>}
                      </div>
                    )}
                    {group.entries.map(entry => (
                      <div key={entry._id}>
                        <span>{storeFrom(entry)?.name || 'Unknown store'} · {formatDate(entry.date)}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                        <strong>{currency(entry.finalPrice)}</strong>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      {scanOpen && (
        <BarcodeResolverDialog
          purpose="prices"
          onClose={() => setScanOpen(false)}
          onResolved={handleScannedProduct}
        />
      )}
    </section>
  );
}
