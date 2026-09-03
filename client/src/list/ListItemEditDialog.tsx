import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import { updateShoppingListItem } from './api';
import {
  actualPurchasedQuantity,
  intendedPurchaseQuantity,
  productName,
  type ShoppingListItem
} from './types';

const listQueryKey = ['shopping-list'] as const;

interface ListItemEditDialogProps {
  item: ShoppingListItem;
  onClose: () => void;
}

function parsePositive(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99) {
    throw new Error(`${label} must be greater than 0 and no more than 99.`);
  }
  return parsed;
}

export function ListItemEditDialog({ item, onClose }: ListItemEditDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [intended, setIntended] = useState(String(intendedPurchaseQuantity(item)));
  const [actual, setActual] = useState(String(actualPurchasedQuantity(item)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const intendedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => intendedRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
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
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
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

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');

    try {
      const intendedQuantity = parsePositive(intended, 'Quantity to buy');
      const patch: Parameters<typeof updateShoppingListItem>[1] = {
        intendedPurchaseQuantity: intendedQuantity
      };
      if (item.checked) patch.actualPurchasedQuantity = parsePositive(actual, 'Actually got');

      const result = await updateShoppingListItem(item._id, patch, item);
      queryClient.setQueryData<ShoppingListItem[]>(listQueryKey, current =>
        current?.map(entry => entry._id === item._id ? { ...entry, ...result.data } : entry) || []
      );
      if (!result.queued) void queryClient.invalidateQueries({ queryKey: listQueryKey });
      showToast(result.queued ? 'Quantity saved offline. It will sync when you reconnect.' : 'Shopping quantity updated', { tone: 'success' });
      onClose();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : 'Could not update that quantity.');
    } finally {
      setSaving(false);
    }
  };

  const required = item.requiredQuantity == null ? null : Number(item.requiredQuantity);
  const intendedNumber = Number(intended);
  const remainder = required == null || !Number.isFinite(intendedNumber)
    ? 0
    : Math.max(0, required - intendedNumber);

  return (
    <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="react-list-modal" role="dialog" aria-modal="true" aria-labelledby="react-list-edit-title" onKeyDown={handleKeyDown}>
        <form onSubmit={save}>
          <div className="react-list-modal-heading">
            <div>
              <p className="react-list-eyebrow">Shopping quantity</p>
              <h2 id="react-list-edit-title">Edit {productName(item)}</h2>
            </div>
            <button type="button" className="react-list-modal-close" aria-label={`Close Edit ${productName(item)}`} disabled={saving} onClick={onClose}>✕</button>
          </div>

          {required != null && (
            <p className="react-list-modal-help">
              Provista currently calculates {required:g} needed. Changing what you plan to buy does not rewrite that Plan/Pantry requirement.
            </p>
          )}

          <label htmlFor="react-list-intended-quantity">
            <span>Plan to buy</span>
            <input
              ref={intendedRef}
              id="react-list-intended-quantity"
              type="number"
              min="0.01"
              max="99"
              step="any"
              value={intended}
              onChange={event => setIntended(event.target.value)}
            />
          </label>

          {remainder > 0 && (
            <div className="react-list-inline-error" role="status">
              Buy {Number.isFinite(intendedNumber) ? intendedNumber : 0} · {remainder} still needed from the current Plan/Pantry requirement.
            </div>
          )}

          {item.checked && (
            <label htmlFor="react-list-actual-quantity">
              <span>Actually got</span>
              <input
                id="react-list-actual-quantity"
                type="number"
                min="0.01"
                max="99"
                step="any"
                value={actual}
                onChange={event => setActual(event.target.value)}
              />
              <small>This is the quantity that will be added to Pantry when you finish shopping.</small>
            </label>
          )}

          {error && <div className="react-list-inline-error" role="alert">{error}</div>}

          <div className="react-list-modal-actions">
            <button type="button" className="shell-button shell-button-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button type="submit" className="shell-button shell-button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save quantity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
