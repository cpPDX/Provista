import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useAuth } from '../auth/AuthProvider';
import { useConfirm } from '../shell/DialogProvider';
import { useToast } from '../shell/ToastProvider';
import { BarcodeResolverDialog } from './BarcodeResolverDialog';
import {
  createCatalogProduct,
  deleteCatalogProduct,
  loadCatalog,
  mergeCatalogProduct,
  removeCatalogAlias,
  updateCatalogProduct
} from './api';
import type { CatalogProductInput, ProductRef } from './types';
import './catalog.css';

const catalogQueryKey = ['catalog-products'] as const;
type OrganicFilter = 'all' | 'organic' | 'conventional';
type SortMode = 'name' | 'lastPurchased';

interface ProductEditorDialogProps {
  product?: ProductRef | null;
  initialName?: string;
  categorySuggestions: string[];
  unitSuggestions: string[];
  online: boolean;
  onClose: () => void;
  onSaved: (product: ProductRef, created: boolean) => void;
}

function formatProductMeta(product: ProductRef) {
  return [product.brand, product.category, product.size != null && product.size !== '' ? `${product.size} ${product.unit || ''}`.trim() : product.unit]
    .filter(Boolean)
    .join(' · ');
}

function formatPurchaseDate(value?: string | null) {
  if (!value) return 'No purchase history';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No purchase history';
  return `Last purchased ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)}`;
}

function focusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(element => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
}

function ProductEditorDialog({
  product = null,
  initialName = '',
  categorySuggestions,
  unitSuggestions,
  online,
  onClose,
  onSaved
}: ProductEditorDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(product?.name || initialName);
  const [brand, setBrand] = useState(product?.brand || '');
  const [category, setCategory] = useState(product?.category || '');
  const [unit, setUnit] = useState(product?.unit || 'each');
  const [size, setSize] = useState(product?.size == null ? '' : String(product.size));
  const [upc, setUpc] = useState(product?.upc || '');
  const [isOrganic, setIsOrganic] = useState(Boolean(product?.isOrganic));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(event.currentTarget);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online) {
      setError('Reconnect before changing the household catalog.');
      return;
    }
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const trimmedUnit = unit.trim();
    if (!trimmedName || !trimmedCategory || !trimmedUnit) {
      setError('Name, category, and unit are required.');
      return;
    }

    const numericSize = size.trim() === '' ? null : Number(size);
    if (numericSize !== null && (!Number.isFinite(numericSize) || numericSize < 0)) {
      setError('Size must be a valid non-negative number.');
      return;
    }

    const input: CatalogProductInput = {
      name: trimmedName,
      brand: brand.trim() || undefined,
      category: trimmedCategory,
      unit: trimmedUnit,
      size: numericSize,
      isOrganic,
      upc: upc.trim() || null,
      upcSource: upc.trim() ? (product?.upcSource || 'manual') : null
    };

    setSaving(true);
    setError('');
    try {
      const saved = product
        ? await updateCatalogProduct(product._id, input)
        : await createCatalogProduct(input);
      onSaved(saved, !product);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this product.');
      setSaving(false);
    }
  };

  return (
    <div className="catalog-modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="catalog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-editor-title"
        onKeyDown={handleKeyDown}
      >
        <div className="catalog-modal-heading">
          <div>
            <p className="catalog-eyebrow">{product ? 'Product details' : 'New product'}</p>
            <h2 id="catalog-editor-title">{product ? product.name : 'Add product'}</h2>
          </div>
          <button ref={closeRef} type="button" className="catalog-icon-button" aria-label="Close product editor" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={event => void submit(event)}>
          <label>
            <span>Name</span>
            <input value={name} onChange={event => setName(event.target.value)} autoComplete="off" required />
          </label>
          <label>
            <span>Brand <small>Optional</small></span>
            <input value={brand} onChange={event => setBrand(event.target.value)} autoComplete="off" />
          </label>
          <div className="catalog-form-grid">
            <label>
              <span>Category</span>
              <input list="catalog-category-suggestions" value={category} onChange={event => setCategory(event.target.value)} required />
              <datalist id="catalog-category-suggestions">{categorySuggestions.map(value => <option value={value} key={value} />)}</datalist>
            </label>
            <label>
              <span>Unit</span>
              <input list="catalog-unit-suggestions" value={unit} onChange={event => setUnit(event.target.value)} required />
              <datalist id="catalog-unit-suggestions">{unitSuggestions.map(value => <option value={value} key={value} />)}</datalist>
            </label>
          </div>
          <div className="catalog-form-grid">
            <label>
              <span>Size <small>Optional</small></span>
              <input type="number" min="0" step="any" inputMode="decimal" value={size} onChange={event => setSize(event.target.value)} />
            </label>
            <label>
              <span>UPC <small>Optional</small></span>
              <input inputMode="numeric" value={upc} onChange={event => setUpc(event.target.value)} />
            </label>
          </div>
          <label className="catalog-checkbox-row">
            <input type="checkbox" checked={isOrganic} onChange={event => setIsOrganic(event.target.checked)} />
            <span>Organic</span>
          </label>
          {error && <div className="catalog-form-error" role="alert">{error}</div>}
          <div className="catalog-modal-actions">
            <button type="button" className="shell-button shell-button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="shell-button shell-button-primary" disabled={saving || !online}>{saving ? 'Saving…' : product ? 'Save product' : 'Add product'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ProductCatalogPage() {
  const { isAdmin } = useAuth();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const catalogQuery = useQuery({ queryKey: catalogQueryKey, queryFn: loadCatalog, enabled: isAdmin });
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [organic, setOrganic] = useState<OrganicFilter>('all');
  const [sortBy, setSortBy] = useState<SortMode>('name');
  const [editorProduct, setEditorProduct] = useState<ProductRef | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitialName, setEditorInitialName] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [busyAlias, setBusyAlias] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);

  const products = catalogQuery.data || [];
  const categorySuggestions = useMemo(() => [...new Set(products.map(product => product.category).filter((value): value is string => Boolean(value)))].sort(), [products]);
  const unitSuggestions = useMemo(() => [...new Set(['each', ...products.map(product => product.unit).filter((value): value is string => Boolean(value))])].sort(), [products]);
  const mergeSource = products.find(product => product._id === mergeSourceId) || null;
  const mergeTarget = products.find(product => product._id === mergeTargetId) || null;
  const mergeTargets = products.filter(product => product._id !== mergeSourceId);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = products.filter(product => {
      if (query && ![product.name, product.brand, product.category, ...(product.aliases || []).map(alias => alias.text)]
        .some(value => String(value || '').toLowerCase().includes(query))) return false;
      if (categories.length && !categories.includes(product.category || '')) return false;
      if (organic === 'organic' && !product.isOrganic) return false;
      if (organic === 'conventional' && product.isOrganic) return false;
      return true;
    });

    result.sort((left, right) => {
      if (sortBy === 'lastPurchased') {
        const leftTime = left.lastPurchasedAt ? new Date(left.lastPurchasedAt).getTime() : Number.NEGATIVE_INFINITY;
        const rightTime = right.lastPurchasedAt ? new Date(right.lastPurchasedAt).getTime() : Number.NEGATIVE_INFINITY;
        if (leftTime !== rightTime) return rightTime - leftTime;
      }
      return left.name.localeCompare(right.name);
    });
    return result;
  }, [products, search, categories, organic, sortBy]);

  const structuredFilterActive = categories.length > 0 || organic !== 'all';
  const openCreate = (initialName = '') => {
    setEditorProduct(null);
    setEditorInitialName(initialName);
    setEditorOpen(true);
  };

  const openEdit = (product: ProductRef) => {
    setEditorProduct(product);
    setEditorInitialName('');
    setEditorOpen(true);
  };

  const handleSaved = async (product: ProductRef, created: boolean) => {
    setEditorOpen(false);
    setEditorProduct(null);
    setEditorInitialName('');
    setSearch('');
    await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
    showToast(created ? `${product.name} added` : `${product.name} updated`, { tone: 'success' });
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget || mergeSource._id === mergeTarget._id) {
      showToast('Choose two different products to merge.', { tone: 'error' });
      return;
    }
    const approved = await confirm({
      title: `Merge ${mergeSource.name} into ${mergeTarget.name}?`,
      message: `Price history, Shopping List entries, and Pantry references will move to ${mergeTarget.name}. ${mergeSource.name} will then be deleted from the household catalog.`,
      confirmLabel: 'Merge products',
      cancelLabel: 'Keep both products'
    });
    if (!approved) return;
    if (!online) {
      showToast('Reconnect before merging products.', { tone: 'error' });
      return;
    }
    setMerging(true);
    try {
      const target = await mergeCatalogProduct(mergeSource._id, mergeTarget._id);
      setMergeSourceId('');
      setMergeTargetId('');
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      showToast(`${mergeSource.name} merged into ${target.name}`, { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not merge those products.', { tone: 'error' });
    } finally {
      setMerging(false);
    }
  };

  const handleDelete = async (product: ProductRef) => {
    const approved = await confirm({
      title: `Delete ${product.name}?`,
      message: 'This removes the product from the household catalog. Existing Pantry, List, or price references may no longer be usable.',
      confirmLabel: 'Delete product',
      cancelLabel: 'Keep product'
    });
    if (!approved) return;
    if (!online) {
      showToast('Reconnect before deleting a product.', { tone: 'error' });
      return;
    }
    try {
      await deleteCatalogProduct(product._id);
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      showToast(`${product.name} deleted`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete that product.', { tone: 'error' });
    }
  };

  const forgetAlias = async (product: ProductRef, aliasId: string, aliasText: string) => {
    if (!online) {
      showToast('Reconnect before changing remembered names.', { tone: 'error' });
      return;
    }
    const key = `${product._id}:${aliasId}`;
    setBusyAlias(key);
    try {
      await removeCatalogAlias(product._id, aliasId);
      await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
      showToast(`Forgot “${aliasText}”`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not forget that name.', { tone: 'error' });
    } finally {
      setBusyAlias('');
    }
  };

  if (!isAdmin) {
    return (
      <section className="catalog-page" aria-labelledby="catalog-title">
        <button type="button" className="catalog-back" onClick={() => navigate('/app/more')}>← More</button>
        <div className="catalog-state"><strong>Admin access required</strong><span>Only household admins can manage products.</span></div>
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-labelledby="catalog-title">
      <header className="catalog-heading">
        <div>
          <button type="button" className="catalog-back" onClick={() => navigate('/app/more')}>← More</button>
          <p className="catalog-eyebrow">Household catalog</p>
          <h1 id="catalog-title">Manage products</h1>
          <p>Keep grocery names and details clean so List, Pantry, scanning, and prices agree.</p>
        </div>
        <div className="catalog-heading-actions">
          <button type="button" className="shell-button shell-button-secondary" disabled={!online} onClick={() => setScanOpen(true)}>Scan</button>
          <button type="button" className="shell-button shell-button-primary" disabled={!online} onClick={() => openCreate()}>Add product</button>
        </div>
      </header>

      {!online && <div className="catalog-offline" role="status">Offline · browse saved catalog data, then reconnect to add or edit products.</div>}

      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span>Search products</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, brand, category, remembered name…" />
        </label>
        <label>
          <span>Sort</span>
          <select value={sortBy} onChange={event => setSortBy(event.target.value as SortMode)}>
            <option value="name">Name A–Z</option>
            <option value="lastPurchased">Last purchased</option>
          </select>
        </label>
        <label>
          <span>Organic</span>
          <select value={organic} onChange={event => setOrganic(event.target.value as OrganicFilter)}>
            <option value="all">All</option>
            <option value="organic">Organic only</option>
            <option value="conventional">Conventional only</option>
          </select>
        </label>
      </div>

      {products.length > 1 && (
        <details className="catalog-merge-panel">
          <summary>Catalog cleanup</summary>
          <div className="catalog-merge-content">
            <p>Merge a duplicate into the product you want to keep. Shopping, Pantry, and price history will follow the kept product.</p>
            <div className="catalog-form-grid">
              <label>
                <span>Duplicate to remove</span>
                <select value={mergeSourceId} onChange={event => {
                  const sourceId = event.target.value;
                  setMergeSourceId(sourceId);
                  if (mergeTargetId === sourceId) setMergeTargetId('');
                }}>
                  <option value="">Choose product…</option>
                  {products.map(product => <option value={product._id} key={product._id}>{product.name}</option>)}
                </select>
              </label>
              <label>
                <span>Product to keep</span>
                <select value={mergeTargetId} disabled={!mergeSourceId} onChange={event => setMergeTargetId(event.target.value)}>
                  <option value="">Choose product…</option>
                  {mergeTargets.map(product => <option value={product._id} key={product._id}>{product.name}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="shell-button shell-button-secondary" disabled={!online || !mergeSource || !mergeTarget || merging} onClick={() => void handleMerge()}>
              {merging ? 'Merging…' : 'Review merge'}
            </button>
          </div>
        </details>
      )}

      {categorySuggestions.length > 0 && (
        <details className="catalog-category-filter">
          <summary>Categories{categories.length ? ` · ${categories.length} selected` : ''}</summary>
          <div>
            {categorySuggestions.map(category => (
              <label key={category}>
                <input
                  type="checkbox"
                  checked={categories.includes(category)}
                  onChange={event => setCategories(current => event.target.checked ? [...current, category] : current.filter(value => value !== category))}
                />
                <span>{category}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      {(structuredFilterActive || sortBy !== 'name') && (
        <div className="catalog-filter-summary" role="status">
          <span>Showing {filtered.length} of {products.length} products</span>
          <button type="button" onClick={() => { setCategories([]); setOrganic('all'); setSortBy('name'); }}>Reset filters</button>
        </div>
      )}

      {catalogQuery.isPending ? (
        <div className="catalog-state" aria-busy="true">Loading products…</div>
      ) : catalogQuery.isError ? (
        <div className="catalog-state">
          <strong>Couldn’t load products</strong>
          <span>{catalogQuery.error instanceof Error ? catalogQuery.error.message : 'Try again when you’re connected.'}</span>
          <button type="button" className="shell-button shell-button-secondary" onClick={() => void catalogQuery.refetch()}>Try again</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="catalog-state">
          <strong>{search.trim() ? `No products match “${search.trim()}”` : 'No products match these filters'}</strong>
          {structuredFilterActive ? (
            <button type="button" className="shell-button shell-button-secondary" onClick={() => { setCategories([]); setOrganic('all'); }}>Clear filters</button>
          ) : search.trim() ? (
            <div className="catalog-empty-actions">
              <button type="button" className="shell-button shell-button-primary" disabled={!online} onClick={() => openCreate(search.trim())}>Add product “{search.trim()}”</button>
              <button type="button" className="shell-button shell-button-secondary" onClick={() => setSearch('')}>Clear search</button>
            </div>
          ) : (
            <button type="button" className="shell-button shell-button-primary" disabled={!online} onClick={() => openCreate()}>Add first product</button>
          )}
        </div>
      ) : (
        <div className="catalog-list" aria-label="Household products">
          {filtered.map(product => (
            <article className="catalog-row" data-product-id={product._id} key={product._id}>
              <button type="button" className="catalog-row-body" aria-label={`Edit ${product.name}`} onClick={() => openEdit(product)}>
                <span className="catalog-row-title">
                  <strong>{product.name}</strong>
                  {product.isOrganic && <em>Organic</em>}
                </span>
                <span>{formatProductMeta(product) || 'Product details not set'}</span>
                {sortBy === 'lastPurchased' && <small>{formatPurchaseDate(product.lastPurchasedAt)}</small>}
              </button>
              <button type="button" className="catalog-icon-button catalog-delete" aria-label={`Delete ${product.name}`} disabled={!online} onClick={() => void handleDelete(product)}>🗑</button>
              {(product.aliases || []).length > 0 && (
                <div className="catalog-aliases" aria-label={`Remembered names for ${product.name}`}>
                  <span>Remembered as:</span>
                  {(product.aliases || []).map(alias => (
                    <button
                      type="button"
                      key={alias._id}
                      disabled={!online || busyAlias === `${product._id}:${alias._id}`}
                      aria-label={`Forget remembered name ${alias.text} for ${product.name}`}
                      onClick={() => void forgetAlias(product, alias._id, alias.text)}
                    >
                      {alias.text} ×
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {editorOpen && (
        <ProductEditorDialog
          product={editorProduct}
          initialName={editorInitialName}
          categorySuggestions={categorySuggestions}
          unitSuggestions={unitSuggestions}
          online={online}
          onClose={() => { setEditorOpen(false); setEditorProduct(null); setEditorInitialName(''); }}
          onSaved={(product, created) => void handleSaved(product, created)}
        />
      )}

      {scanOpen && (
        <BarcodeResolverDialog
          purpose="catalog"
          onClose={() => setScanOpen(false)}
          onResolved={async product => {
            setScanOpen(false);
            await queryClient.invalidateQueries({ queryKey: catalogQueryKey });
            showToast(`${product.name} is in the catalog`, { tone: 'success' });
          }}
        />
      )}
    </section>
  );
}