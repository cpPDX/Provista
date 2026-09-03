import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  createCatalogProduct,
  enrichLocalBarcodeProduct,
  loadProductPriceContext,
  lookupBarcode,
  refreshProductExternalPrice
} from './api';
import type {
  BarcodeLookupResult,
  ExternalPriceRefreshResult,
  ProductPriceContext,
  ProductRef
} from './types';
import './barcode-resolver.css';

type BarcodePurpose = 'list' | 'pantry' | 'prices' | 'catalog';
type ResolverStage = 'scan' | 'lookup' | 'review' | 'saving';

interface BarcodeResolverDialogProps {
  purpose: BarcodePurpose;
  storeId?: string | null;
  onClose: () => void;
  onResolved: (product: ProductRef) => void | Promise<void>;
  onPriceContext?: (
    product: ProductRef,
    context: ProductPriceContext | null,
    refresh: ExternalPriceRefreshResult | null
  ) => void;
}

const PURPOSE_COPY: Record<BarcodePurpose, { eyebrow: string; title: string; action: string }> = {
  list: { eyebrow: 'Add to List', title: 'Scan a grocery', action: 'Add to List' },
  pantry: { eyebrow: 'Pantry', title: 'Scan a package', action: 'Track in Pantry' },
  prices: { eyebrow: 'Prices', title: 'Scan a product', action: 'Use for price' },
  catalog: { eyebrow: 'Products', title: 'Scan a product', action: 'Save product' }
};

function normalizeManualUpc(value: string) {
  return value.replace(/[\s-]+/g, '').trim();
}

function productSummary(item: Partial<ProductRef>) {
  return [item.brand, item.category, item.unit, item.size != null ? String(item.size) : '']
    .filter(Boolean)
    .join(' · ');
}

export function BarcodeResolverDialog({
  purpose,
  storeId = null,
  onClose,
  onResolved,
  onPriceContext
}: BarcodeResolverDialogProps) {
  const copy = PURPOSE_COPY[purpose];
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const codeReaderRef = useRef<{ reset: () => void } | null>(null);
  const resolvingRef = useRef(false);
  const [stage, setStage] = useState<ResolverStage>('scan');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUpc, setManualUpc] = useState('');
  const [status, setStatus] = useState('Starting camera…');
  const [error, setError] = useState('');
  const [lookup, setLookup] = useState<BarcodeLookupResult | null>(null);
  const [editingAll, setEditingAll] = useState(false);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [size, setSize] = useState('');
  const [isOrganic, setIsOrganic] = useState(false);

  const stopCamera = () => {
    try {
      codeReaderRef.current?.reset();
    } catch {
      // Camera cleanup is best-effort.
    }
    codeReaderRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let cancelled = false;

    const startCamera = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/library');
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        codeReaderRef.current = reader;
        setStatus('Align the package barcode in the frame.');
        await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result) => {
            if (!result || resolvingRef.current) return;
            void resolveUpc(result.getText());
          }
        );
      } catch (cameraError) {
        if (cancelled) return;
        console.info('Barcode camera unavailable:', cameraError);
        const name = cameraError instanceof Error ? cameraError.name : '';
        const message = name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Camera access was not allowed. Enter the UPC instead.'
          : name === 'NotFoundError'
            ? 'No camera was found. Enter the UPC instead.'
            : 'Camera scanning is unavailable. Enter the UPC instead.';
        setStatus(message);
        setManualOpen(true);
        window.setTimeout(() => manualRef.current?.focus(), 0);
      }
    };

    window.setTimeout(() => closeRef.current?.focus(), 0);
    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
    // The resolver is intentionally initialized once per dialog instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateReview = (result: BarcodeLookupResult) => {
    const item = result.item || {};
    setLookup(result);
    setName(String(item.name || ''));
    setBrand(String(item.brand || ''));
    setCategory(String(item.category || ''));
    setUnit(String(item.unit || ''));
    setSize(item.size == null ? '' : String(item.size));
    setIsOrganic(Boolean(item.isOrganic));
    setEditingAll(false);
    setStage('review');
  };

  const publishPriceContext = (product: ProductRef) => {
    void (async () => {
      let context: ProductPriceContext | null = null;
      let refresh: ExternalPriceRefreshResult | null = null;
      try {
        context = await loadProductPriceContext(product._id, storeId);
        onPriceContext?.(product, context, null);
      } catch (contextError) {
        console.info('Household price context unavailable:', contextError);
      }

      try {
        refresh = await refreshProductExternalPrice(product._id, storeId);
        onPriceContext?.(product, context, refresh);
      } catch (refreshError) {
        console.info('External price refresh unavailable:', refreshError);
      }
    })();
  };

  const finishResolved = async (product: ProductRef) => {
    publishPriceContext(product);
    await onResolved(product);
    onClose();
  };

  const resolveUpc = async (rawUpc: string) => {
    const upc = normalizeManualUpc(rawUpc);
    if (!/^\d{8,14}$/.test(upc)) {
      setError('Enter the 8–14 digit UPC/EAN printed under the barcode.');
      setManualOpen(true);
      window.setTimeout(() => manualRef.current?.focus(), 0);
      return;
    }
    if (resolvingRef.current) return;

    resolvingRef.current = true;
    stopCamera();
    setError('');
    setStatus('Looking up that product…');
    setStage('lookup');

    try {
      const result = await lookupBarcode(upc);
      if (result.source === 'local' && result.item._id) {
        const product = result.item as ProductRef;
        // Existing household identity should be immediate. Any safe blank-field
        // enrichment happens after continuation and can never overwrite it.
        void enrichLocalBarcodeProduct(upc).catch(enrichmentError => {
          console.info('Barcode metadata enrichment unavailable:', enrichmentError);
        });
        await finishResolved(product);
        return;
      }

      if (result.found && result.confidence === 'full' && result.autoAccept) {
        const product = await createCatalogProduct({
          name: String(result.item.name),
          brand: String(result.item.brand || ''),
          category: String(result.item.category),
          unit: String(result.item.unit),
          size: result.item.size == null ? null : Number(result.item.size),
          isOrganic: Boolean(result.item.isOrganic),
          upc,
          upcSource: 'scan',
          upcPendingLookup: false
        });
        await finishResolved(product);
        return;
      }

      hydrateReview(result);
      setStatus(result.found
        ? 'Product found. Confirm it or correct the details that need attention.'
        : 'This barcode is not in the public catalog yet. Add only the missing details.');
    } catch (lookupError) {
      console.error(lookupError);
      setStage('scan');
      setManualOpen(true);
      setStatus('Barcode lookup could not finish. You can retry the UPC.');
      setError(lookupError instanceof Error ? lookupError.message : 'Barcode lookup failed.');
      window.setTimeout(() => manualRef.current?.focus(), 0);
    } finally {
      resolvingRef.current = false;
    }
  };

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    void resolveUpc(manualUpc);
  };

  const saveReviewed = async () => {
    if (!lookup || stage === 'saving') return;
    const missing = new Set(lookup.missingFields || []);
    if (!name.trim()) {
      setError('Product name is required.');
      return;
    }
    if (!category.trim()) {
      setError('Category is required.');
      return;
    }
    if (!unit.trim()) {
      setError('Unit is required.');
      return;
    }

    setStage('saving');
    setError('');
    try {
      const parsedSize = size.trim() === '' ? null : Number(size);
      if (parsedSize != null && (!Number.isFinite(parsedSize) || parsedSize < 0)) {
        throw new Error('Package size must be zero or more.');
      }
      const product = await createCatalogProduct({
        name: name.trim(),
        brand: brand.trim(),
        category: category.trim(),
        unit: unit.trim(),
        size: parsedSize,
        isOrganic,
        upc: String(lookup.item.upc || manualUpc),
        upcSource: 'scan',
        upcPendingLookup: false
      });
      await finishResolved(product);
    } catch (saveError) {
      console.error(saveError);
      setStage('review');
      setError(saveError instanceof Error ? saveError.message : 'Could not save that product.');
    }
  };

  const close = () => {
    if (stage === 'saving') return;
    stopCamera();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), video[tabindex="0"]'
    )];
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

  const missing = new Set(lookup?.missingFields || []);
  const compactReview = Boolean(lookup?.found && lookup.confidence === 'full' && !editingAll);
  const showField = (field: string) => editingAll || !lookup?.found || missing.has(field);

  return (
    <div className="barcode-resolver-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="barcode-resolver" role="dialog" aria-modal="true" aria-labelledby="barcode-resolver-title" onKeyDown={handleKeyDown}>
        <div className="barcode-resolver-heading">
          <div>
            <p className="barcode-resolver-eyebrow">{copy.eyebrow}</p>
            <h2 id="barcode-resolver-title">{copy.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="barcode-resolver-close" aria-label={`Close ${copy.title}`} disabled={stage === 'saving'} onClick={close}>✕</button>
        </div>

        {(stage === 'scan' || stage === 'lookup') && (
          <>
            <p className="barcode-resolver-help">Scan the package to identify it. Provista will use what it already knows and ask only about exceptions.</p>
            <div className="barcode-camera-frame" data-active={stage === 'scan'}>
              <video ref={videoRef} muted playsInline tabIndex={0} aria-label="Barcode camera preview" />
              <span aria-hidden="true" className="barcode-camera-guide" />
            </div>
            <p className="barcode-resolver-status" role="status" aria-live="polite">{status}</p>

            <button type="button" className="shell-button shell-button-secondary barcode-manual-toggle" disabled={stage === 'lookup'} onClick={() => {
              stopCamera();
              setManualOpen(true);
              setStatus('Enter the UPC/EAN printed under the barcode.');
              window.setTimeout(() => manualRef.current?.focus(), 0);
            }}>
              Enter UPC instead
            </button>

            {manualOpen && (
              <form className="barcode-manual-form" onSubmit={submitManual}>
                <label htmlFor="barcode-manual-upc">
                  <span>UPC / EAN</span>
                  <input
                    ref={manualRef}
                    id="barcode-manual-upc"
                    inputMode="numeric"
                    autoComplete="off"
                    value={manualUpc}
                    disabled={stage === 'lookup'}
                    placeholder="012345678905"
                    onChange={event => setManualUpc(event.target.value)}
                  />
                </label>
                <button type="submit" className="shell-button shell-button-primary" disabled={stage === 'lookup' || !manualUpc.trim()}>
                  {stage === 'lookup' ? 'Looking up…' : 'Look up product'}
                </button>
              </form>
            )}
          </>
        )}

        {stage === 'review' && lookup && (
          <div className="barcode-review">
            <p className="barcode-resolver-status" role="status" aria-live="polite">{status}</p>
            <div className="barcode-upc">UPC {lookup.item.upc || manualUpc}</div>

            {compactReview ? (
              <div className="barcode-product-summary">
                <strong>{name}</strong>
                {productSummary({ brand, category, unit, size }) && <span>{productSummary({ brand, category, unit, size })}</span>}
                {isOrganic && <span>Organic</span>}
              </div>
            ) : (
              <div className="barcode-found-summary">
                {lookup.item.name && !showField('name') && <strong>{String(lookup.item.name)}</strong>}
                {productSummary(lookup.item) && <span>{productSummary(lookup.item)}</span>}
              </div>
            )}

            {!compactReview && (
              <div className="barcode-review-fields">
                {showField('name') && <label><span>Product name</span><input value={name} onChange={event => setName(event.target.value)} /></label>}
                {(editingAll || !lookup.found) && <label><span>Brand <small>(optional)</small></span><input value={brand} onChange={event => setBrand(event.target.value)} /></label>}
                {showField('category') && <label><span>Category</span><input value={category} onChange={event => setCategory(event.target.value)} /></label>}
                {showField('unit') && <label><span>Unit</span><input value={unit} onChange={event => setUnit(event.target.value)} /></label>}
                {(editingAll || !lookup.found) && <label><span>Package size <small>(optional)</small></span><input type="number" min="0" step="any" value={size} onChange={event => setSize(event.target.value)} /></label>}
                {(editingAll || !lookup.found) && <label className="barcode-organic"><input type="checkbox" checked={isOrganic} onChange={event => setIsOrganic(event.target.checked)} /><span>Organic</span></label>}
              </div>
            )}

            {lookup.found && !editingAll && (
              <button type="button" className="barcode-edit-found" onClick={() => setEditingAll(true)}>Correct found details</button>
            )}

            <div className="barcode-resolver-actions">
              <button type="button" className="shell-button shell-button-secondary" onClick={close}>Cancel</button>
              <button type="button" className="shell-button shell-button-primary" onClick={() => void saveReviewed()}>{copy.action}</button>
            </div>
          </div>
        )}

        {stage === 'saving' && <p className="barcode-resolver-status" role="status" aria-live="polite">Saving product…</p>}
        {error && <p className="barcode-resolver-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
