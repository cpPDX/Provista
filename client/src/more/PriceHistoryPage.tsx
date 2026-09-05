import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import {
  approvePrice,
  createPrice,
  loadInsightItems,
  loadInsightStores,
  loadPendingPrices,
  loadPrices,
  rejectPrice,
  type InsightItem,
  type InsightStore,
  type PriceEntryRecord
} from './insightsApi';
import './more.css';

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthNumber, 1, 0, 0, 0, 0);
  return { startDate: start.toISOString(), endDate: new Date(end.getTime() - 1).toISOString() };
}

function itemFrom(entry: PriceEntryRecord) {
  return typeof entry.itemId === 'string' ? null : entry.itemId;
}

function storeFrom(entry: PriceEntryRecord) {
  return typeof entry.storeId === 'string' ? null : entry.storeId;
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

type SortMode = 'date' | 'name' | 'price';

export function PriceHistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin } = useAuth();
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
  const [recordItemId, setRecordItemId] = useState('');
  const [recordStoreId, setRecordStoreId] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [date, setDate] = useState(localDateValue());
  const [salePrice, setSalePrice] = useState('');
  const [couponAmount, setCouponAmount] = useState('');
  const [couponCode, setCouponCode] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const params = month ? monthRange(month) : {};
      if (drillStoreId) params.storeId = drillStoreId;
      const [priceRows, itemRows, storeRows, pendingRows] = await Promise.all([
        loadPrices(params),
        loadInsightItems(),
        loadInsightStores(),
        isAdmin ? loadPendingPrices() : Promise.resolve([])
      ]);
      setEntries(priceRows);
      setItems(itemRows.sort((a, b) => a.name.localeCompare(b.name)));
      setStores(storeRows.sort((a, b) => a.name.localeCompare(b.name)));
      setPending(pendingRows);
    } catch (error) {
      showToast(errorMessage(error, 'Failed to load price history'), { tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [month, drillStoreId, isAdmin]);

  useEffect(() => {
    setCategory(drillCategory);
    setStoreId(drillStoreId);
    if (drillStoreName && !drillStoreId) setSearch(drillStoreName);
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
      const current = byItem.get(id) || { item, entries: [] };
      current.entries.push(entry);
      byItem.set(id, current);
    }
    const result = [...byItem.values()];
    if (sortMode === 'name') result.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''));
    if (sortMode === 'price') result.sort((a, b) => (a.entries[0]?.finalPrice || 0) - (b.entries[0]?.finalPrice || 0));
    return result;
  }, [visibleEntries, sortMode]);

  const filtersActive = Boolean(search || category || storeId || organicOnly || saleOnly || month);

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
    const regular = Number(regularPrice);
    const sale = salePrice ? Number(salePrice) : null;
    const coupon = couponAmount ? Number(couponAmount) : 0;
    const qty = Number(quantity) || 1;
    if (!Number.isFinite(regular) || regular < 0) return null;
    const base = sale != null && Number.isFinite(sale) && sale < regular ? sale : regular;
    const final = Math.max(0, base - (Number.isFinite(coupon) ? coupon : 0));
    return { final, perUnit: final / qty };
  }, [regularPrice, salePrice, couponAmount, quantity]);

  const submitPrice = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !recordItemId || !recordStoreId || !regularPrice) return;
    setSaving(true);
    try {
      const created = await createPrice({
        itemId: recordItemId,
        storeId: recordStoreId,
        regularPrice: Number(regularPrice),
        salePrice: salePrice ? Number(salePrice) : null,
        couponAmount: couponAmount ? Number(couponAmount) : null,
        couponCode: couponCode.trim() || null,
        quantity: Number(quantity) || 1,
        date,
        source: 'manual'
      });
      setEntries(current => [created, ...current]);
      if (created.status === 'pending') {
        showToast('Price submitted for household review', { tone: 'success' });
      } else {
        showToast('Price recorded', { tone: 'success' });
      }
      setShowRecord(false);
      setRegularPrice('');
      setSalePrice('');
      setCouponAmount('');
      setCouponCode('');
      setQuantity('1');
      setDate(localDateValue());
    } catch (error) {
      showToast(errorMessage(error, 'Failed to record price'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const approvePending = async (entry: PriceEntryRecord) => {
    try {
      const approved = await approvePrice(entry._id);
      setPending(current => current.filter(row => row._id !== entry._id));
      setEntries(current => [approved, ...current.filter(row => row._id !== entry._id)]);
      showToast('Price approved', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to approve price'), { tone: 'error' });
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
      showToast('Price rejected', { tone: 'success' });
    } catch (error) {
      showToast(errorMessage(error, 'Failed to reject price'), { tone: 'error' });
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
            <p>Use this for a price the household actually paid or confirmed.</p>
          </div>
          {items.length && stores.length ? (
            <>
              <div className="more-field-grid">
                <label className="more-field"><span>Product</span><select value={recordItemId} onChange={event => setRecordItemId(event.target.value)} required><option value="">Choose product</option>{items.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>
                <label className="more-field"><span>Store</span><select value={recordStoreId} onChange={event => setRecordStoreId(event.target.value)} required><option value="">Choose store</option>{stores.map(store => <option key={store._id} value={store._id}>{store.name}{store.location ? ` - ${store.location}` : ''}</option>)}</select></label>
                <label className="more-field"><span>Regular price</span><input type="number" inputMode="decimal" min="0" step="0.01" value={regularPrice} onChange={event => setRegularPrice(event.target.value)} required /></label>
                <label className="more-field"><span>Quantity</span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
                <label className="more-field"><span>Date</span><input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
              </div>
              <details className="more-advanced-settings">
                <summary>Sale or coupon details</summary>
                <div className="more-field-grid">
                  <label className="more-field"><span>Sale price <small>(optional)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={salePrice} onChange={event => setSalePrice(event.target.value)} /></label>
                  <label className="more-field"><span>Coupon amount <small>(optional)</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={couponAmount} onChange={event => setCouponAmount(event.target.value)} /></label>
                  <label className="more-field"><span>Coupon code <small>(optional)</small></span><input value={couponCode} onChange={event => setCouponCode(event.target.value)} /></label>
                </div>
              </details>
              {finalPreview && <div className="more-price-preview" role="status"><strong>{currency(finalPreview.final)}</strong><span>{currency(finalPreview.perUnit)} per unit</span></div>}
              <button type="submit" className="shell-button shell-button-primary" disabled={saving || !recordItemId || !recordStoreId || !regularPrice}>{saving ? 'Recording…' : 'Record price'}</button>
            </>
          ) : (
            <div className="more-status-card">Create at least one <Link to="/app/more/products">product</Link> and <Link to="/app/more/stores">store</Link> before recording a price.</div>
          )}
        </form>
      )}

      <details className="more-advanced-settings more-insights-filters" open={Boolean(category || storeId || organicOnly || saleOnly)}>
        <summary>Filter and sort</summary>
        <div className="more-field-grid">
          <label className="more-field"><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="more-field"><span>Store</span><select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">All stores</option>{stores.map(store => <option key={store._id} value={store._id}>{store.name}</option>)}</select></label>
          <label className="more-field"><span>Sort by</span><select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}><option value="date">Newest</option><option value="name">Name A-Z</option><option value="price">Lowest price</option></select></label>
        </div>
        <div className="more-inline-actions">
          <label className="more-check-row"><input type="checkbox" checked={organicOnly} onChange={event => setOrganicOnly(event.target.checked)} /><span>Organic only</span></label>
          <label className="more-check-row"><input type="checkbox" checked={saleOnly} onChange={event => setSaleOnly(event.target.checked)} /><span>On sale only</span></label>
        </div>
        {filtersActive && <button type="button" className="shell-button shell-button-secondary" onClick={clearFilters}>Clear filters</button>}
      </details>

      {isAdmin && pending.length > 0 && (
        <section className="more-settings-card" aria-labelledby="pending-prices-title">
          <div><h2 id="pending-prices-title">Prices awaiting review</h2><p>Approve household-submitted prices before they become shared spending history.</p></div>
          <div className="more-record-list">
            {pending.map(entry => {
              const item = itemFrom(entry);
              const store = storeFrom(entry);
              return <div className="more-record-card more-record-row" key={entry._id}><div><strong>{item?.name || 'Unknown product'} - {currency(entry.finalPrice)}</strong><small>{store?.name || 'Unknown store'} · {formatDate(entry.date)}</small></div><div className="more-inline-actions"><button type="button" className="shell-button shell-button-primary" onClick={() => void approvePending(entry)}>Approve</button><button type="button" className="shell-button shell-button-secondary" onClick={() => void rejectPending(entry)}>Reject</button></div></div>;
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
              return (
                <details className="more-price-card" key={group.item?._id || String(latest.itemId)}>
                  <summary>
                    <span><strong>{group.item?.name || 'Unknown product'}</strong><small>{store?.name || 'Unknown store'} · {formatDate(latest.date)}</small></span>
                    <span className="more-price-card-value"><strong>{currency(latest.finalPrice)}</strong><small>{currency(latest.pricePerUnit)} / {group.item?.unit || 'unit'}</small></span>
                  </summary>
                  <div className="more-price-history-rows">
                    {group.entries.map(entry => <div key={entry._id}><span>{storeFrom(entry)?.name || 'Unknown store'} · {formatDate(entry.date)}</span><strong>{currency(entry.finalPrice)}</strong></div>)}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
