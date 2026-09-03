import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import { loadStoreSections, updateStoreSection } from './api';
import { productFor, productName, type ShoppingListItem } from './types';
import './storeSections.css';

export const DEFAULT_STORE_SECTIONS = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Frozen',
  'Household',
  'Other'
] as const;

const CATEGORY_SECTIONS = new Map<string, string>([
  ['produce', 'Produce'],
  ['meat & seafood', 'Meat & Seafood'],
  ['meat and seafood', 'Meat & Seafood'],
  ['meat', 'Meat & Seafood'],
  ['seafood', 'Meat & Seafood'],
  ['dairy', 'Dairy & Eggs'],
  ['dairy & eggs', 'Dairy & Eggs'],
  ['eggs', 'Dairy & Eggs'],
  ['bakery', 'Bakery'],
  ['bread', 'Bakery'],
  ['pantry', 'Pantry'],
  ['beverages', 'Pantry'],
  ['snacks', 'Pantry'],
  ['condiments & sauces', 'Pantry'],
  ['condiments and sauces', 'Pantry'],
  ['frozen', 'Frozen'],
  ['cleaning & household', 'Household'],
  ['cleaning and household', 'Household'],
  ['household', 'Household'],
  ['other', 'Other']
]);

export const storeSectionsQueryKey = ['store-sections'] as const;

function inferredSection(item: ShoppingListItem) {
  const category = String(productFor(item)?.category || '').trim().toLowerCase();
  return CATEGORY_SECTIONS.get(category) || 'Other';
}

export function useStoreSections(items: ShoppingListItem[]) {
  const query = useQuery({ queryKey: storeSectionsQueryKey, queryFn: loadStoreSections });

  const savedByItem = useMemo(() => new Map(
    (query.data?.saved || []).map(entry => [entry.itemId, entry.storeSection])
  ), [query.data?.saved]);

  const sectionFor = (item: ShoppingListItem) => {
    const product = productFor(item);
    if (product?._id) {
      const saved = savedByItem.get(product._id);
      if (saved) return saved;
    }
    return inferredSection(item);
  };

  const group = (groupItems: ShoppingListItem[]) => {
    const map = new Map<string, ShoppingListItem[]>();
    groupItems.forEach(item => {
      const section = sectionFor(item);
      const current = map.get(section) || [];
      current.push(item);
      map.set(section, current);
    });

    const defaultOrder = query.data?.defaults?.length ? query.data.defaults : [...DEFAULT_STORE_SECTIONS];
    const order = new Map(defaultOrder.map((section, index) => [section, index]));
    return [...map.entries()].sort(([left], [right]) => {
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
      if (leftOrder !== undefined) return -1;
      if (rightOrder !== undefined) return 1;
      return left.localeCompare(right);
    });
  };

  return {
    query,
    sectionFor,
    group,
    suggestions: query.data?.suggestions?.length ? query.data.suggestions : [...DEFAULT_STORE_SECTIONS]
  };
}

export function StoreSectionControl({ item, currentSection, suggestions }: {
  item: ShoppingListItem;
  currentSection: string;
  suggestions: string[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentSection);
  const [saving, setSaving] = useState(false);
  const product = productFor(item);

  if (!product?._id) return null;

  const close = () => {
    if (saving) return;
    setOpen(false);
    setValue(currentSection);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      showToast('Enter a store section', { tone: 'error' });
      return;
    }
    if (next.length > 80) {
      showToast('Keep the store section to 80 characters or fewer', { tone: 'error' });
      return;
    }

    setSaving(true);
    try {
      const updated = await updateStoreSection(product._id, next);
      await queryClient.invalidateQueries({ queryKey: storeSectionsQueryKey });
      setOpen(false);
      showToast(`${productName(item)} will appear under ${updated.storeSection}`, { tone: 'success' });
    } catch (error) {
      console.error(error);
      showToast('Could not save that store section', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="react-list-section-control"
        aria-label={`Edit store section for ${productName(item)}: ${currentSection}`}
        onClick={() => { setValue(currentSection); setOpen(true); }}
      >
        Section: {currentSection}
      </button>

      {open && (
        <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
          <div
            className="react-list-modal react-store-section-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="react-store-section-title"
            onKeyDown={event => { if (event.key === 'Escape') close(); }}
          >
            <form onSubmit={save}>
              <div className="react-list-modal-heading">
                <div>
                  <p className="react-list-eyebrow">Shopping organization</p>
                  <h2 id="react-store-section-title">Store section</h2>
                </div>
                <button type="button" className="react-list-modal-close" aria-label="Close store section" onClick={close} disabled={saving}>✕</button>
              </div>

              <p className="react-list-modal-help">Where do you usually find <strong>{productName(item)}</strong>? Choose a familiar section or type your own. Provista remembers it for your household.</p>

              <label htmlFor={`store-section-${item._id}`}>
                <span>Section</span>
                <input
                  id={`store-section-${item._id}`}
                  value={value}
                  onChange={event => setValue(event.target.value)}
                  list={`store-section-suggestions-${item._id}`}
                  role="combobox"
                  aria-autocomplete="list"
                  autoComplete="off"
                  maxLength={80}
                  autoFocus
                />
                <datalist id={`store-section-suggestions-${item._id}`}>
                  {suggestions.map(section => <option value={section} key={section} />)}
                </datalist>
              </label>

              <div className="react-list-modal-actions">
                <button type="button" className="shell-button shell-button-secondary" onClick={close} disabled={saving}>Cancel</button>
                <button type="submit" className="shell-button shell-button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save section'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
