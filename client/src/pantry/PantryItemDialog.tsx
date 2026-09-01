import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createCatalogProduct } from '../products/api';
import { ProductPickerField } from '../products/ProductPickerField';
import type { ProductRef } from '../products/types';
import { createPantryItem, updatePantryItem } from './api';
import {
  pantryProductName,
  pantryUnit,
  type PantryItem,
  type PantryStockStatus,
  type PantryTrackingMode
} from './types';

interface PantryItemDialogProps {
  mode: 'add' | 'edit';
  item?: PantryItem | null;
  prefill?: string;
  online: boolean;
  onClose: () => void;
  onSaved: (item: PantryItem) => void | Promise<void>;
}

function numericValue(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or more.`);
  return parsed;
}

export function PantryItemDialog({ mode, item = null, prefill = '', online, onClose, onSaved }: PantryItemDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductRef | null>(null);
  const [category, setCategory] = useState('Other');
  const [unit, setUnit] = useState('each');
  const [trackingMode, setTrackingMode] = useState<PantryTrackingMode>('simple');
  const [stockStatus, setStockStatus] = useState<PantryStockStatus>('have');
  const [quantity, setQuantity] = useState('1');
  const [threshold, setThreshold] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'edit' && item) {
      setName(pantryProductName(item));
      setSelectedProduct(null);
      setCategory('Other');
      setUnit(pantryUnit(item) || 'each');
      setTrackingMode(item.trackingMode || 'simple');
      setStockStatus(item.stockStatus || 'have');
      setQuantity(String(Number(item.quantity) || 0));
      setThreshold(item.lowStockThreshold == null ? '' : String(item.lowStockThreshold));
      setNotes(item.notes || '');
      setError('');
      return;
    }

    setName(prefill.trim());
    setSelectedProduct(null);
    setCategory('Other');
    setUnit('each');
    setTrackingMode('simple');
    setStockStatus('have');
    setQuantity('1');
    setThreshold('');
    setNotes('');
    setError('');
  }, [item?._id, mode, prefill]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      (nameRef.current || closeRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !online) return;
    setSaving(true);
    setError('');

    try {
      const trimmedNotes = notes.trim();
      const tracking = trackingMode === 'simple'
        ? {
            trackingMode: 'simple' as const,
            stockStatus,
            lowStockThreshold: null,
            notes: trimmedNotes
          }
        : {
            trackingMode: 'exact' as const,
            quantity: numericValue(quantity, 'Quantity'),
            lowStockThreshold: threshold.trim() === '' ? null : numericValue(threshold, 'Low-stock threshold'),
            notes: trimmedNotes
          };

      let saved: PantryItem;
      if (mode === 'edit') {
        if (!item) throw new Error('Pantry item is no longer available.');
        saved = await updatePantryItem(item._id, tracking);
      } else {
        let product = selectedProduct;
        if (!product) {
          const trimmedName = name.trim();
          if (!trimmedName) throw new Error('Enter a product name.');
          product = await createCatalogProduct({
            name: trimmedName,
            category: category.trim() || 'Other',
            unit: unit.trim() || 'each'
          });
        }
        saved = await createPantryItem({
          itemId: product._id,
          unit: product.unit || unit.trim() || 'each',
          ...tracking
        });
      }

      await onSaved(saved);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'Could not save that Pantry item.');
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'edit' && item ? `Track ${pantryProductName(item)}` : 'Track an item';

  return (
    <div className="pantry-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="pantry-modal" role="dialog" aria-modal="true" aria-labelledby="pantry-dialog-title" onKeyDown={handleKeyDown}>
        <form onSubmit={submit}>
          <div className="pantry-modal-heading">
            <div>
              <p className="pantry-eyebrow">Pantry tracking</p>
              <h2 id="pantry-dialog-title">{title}</h2>
            </div>
            <button ref={closeRef} type="button" className="pantry-modal-close" aria-label={`Close ${title}`} disabled={saving} onClick={onClose}>✕</button>
          </div>

          {mode === 'add' ? (
            <ProductPickerField
              idPrefix="pantry-product"
              inputRef={nameRef}
              name={name}
              onNameChange={setName}
              selectedProduct={selectedProduct}
              onSelectedProductChange={setSelectedProduct}
              category={category}
              onCategoryChange={setCategory}
              unit={unit}
              onUnitChange={setUnit}
              online={online}
              nameLabel="What do you want to track?"
            />
          ) : (
            <p className="pantry-dialog-product">{name}</p>
          )}

          <fieldset className="pantry-tracking-choice">
            <legend>How should Provista track this?</legend>
            <label>
              <input type="radio" name="pantry-tracking-mode" value="simple" checked={trackingMode === 'simple'} onChange={() => setTrackingMode('simple')} />
              <span><strong>Simple</strong><small>I’ll mark it Have, Running low, or Out.</small></span>
            </label>
            <label>
              <input type="radio" name="pantry-tracking-mode" value="exact" checked={trackingMode === 'exact'} onChange={() => setTrackingMode('exact')} />
              <span><strong>Exact quantity</strong><small>I’ll track a number and Provista can mark it low automatically.</small></span>
            </label>
          </fieldset>

          {trackingMode === 'simple' ? (
            <label className="pantry-field" htmlFor="pantry-stock-status">
              <span>What do you have right now?</span>
              <select id="pantry-stock-status" value={stockStatus} onChange={event => setStockStatus(event.target.value as PantryStockStatus)}>
                <option value="have">Have</option>
                <option value="low">Running low</option>
                <option value="out">Out</option>
              </select>
            </label>
          ) : (
            <div className="pantry-dialog-grid">
              <label className="pantry-field" htmlFor="pantry-exact-quantity">
                <span>How many are left?</span>
                <input id="pantry-exact-quantity" type="number" min="0" step="any" value={quantity} onChange={event => setQuantity(event.target.value)} />
              </label>
              <label className="pantry-field" htmlFor="pantry-low-threshold">
                <span>Mark Running low at or below <small>(optional)</small></span>
                <input id="pantry-low-threshold" type="number" min="0" step="any" value={threshold} onChange={event => setThreshold(event.target.value)} placeholder="e.g. 2" />
              </label>
            </div>
          )}

          <label className="pantry-field" htmlFor="pantry-notes">
            <span>Notes <small>(optional)</small></span>
            <input id="pantry-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="e.g. expires Friday" />
          </label>

          {!online && <p className="pantry-dialog-warning" role="status">Reconnect before changing Pantry. Your current stock stays visible.</p>}
          {error && <p className="pantry-dialog-error" role="alert">{error}</p>}

          <div className="pantry-modal-actions">
            <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="shell-button shell-button-primary" disabled={saving || !online || (mode === 'add' && !name.trim())}>
              {saving ? 'Saving…' : mode === 'edit' ? 'Save tracking' : 'Track item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
