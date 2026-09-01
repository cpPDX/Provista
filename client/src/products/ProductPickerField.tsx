import { useEffect, useMemo, useState, type Ref } from 'react';
import { searchCatalog } from './api';
import type { ProductRef } from './types';
import './product-picker.css';

interface ProductPickerFieldProps {
  idPrefix: string;
  name: string;
  onNameChange: (name: string) => void;
  selectedProduct: ProductRef | null;
  onSelectedProductChange: (product: ProductRef | null) => void;
  category: string;
  onCategoryChange: (category: string) => void;
  unit: string;
  onUnitChange: (unit: string) => void;
  online: boolean;
  initialCandidates?: ProductRef[];
  inputRef?: Ref<HTMLInputElement>;
  nameLabel?: string;
}

function productLabel(product: ProductRef) {
  return [product.name, product.brand, product.category].filter(Boolean).join(' · ');
}

export function ProductPickerField({
  idPrefix,
  name,
  onNameChange,
  selectedProduct,
  onSelectedProductChange,
  category,
  onCategoryChange,
  unit,
  onUnitChange,
  online,
  initialCandidates = [],
  inputRef,
  nameLabel = 'What do you need?'
}: ProductPickerFieldProps) {
  const [matches, setMatches] = useState<ProductRef[]>(initialCandidates);
  const [searching, setSearching] = useState(false);

  const candidateKey = useMemo(
    () => initialCandidates.map(candidate => candidate._id).join('|'),
    [initialCandidates]
  );

  useEffect(() => {
    setMatches(initialCandidates);
  }, [candidateKey]);

  useEffect(() => {
    const query = name.trim();
    if (!online || query.length < 2) {
      setSearching(false);
      if (!query) setMatches(initialCandidates);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchCatalog(query)
        .then(results => {
          if (cancelled) return;
          const merged = new Map<string, ProductRef>();
          initialCandidates.forEach(product => merged.set(product._id, product));
          results.forEach(product => merged.set(product._id, product));
          setMatches([...merged.values()].slice(0, 8));
        })
        .catch(error => {
          if (!cancelled) console.info('Catalog search unavailable:', error);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [candidateKey, initialCandidates, name, online]);

  return (
    <div className="product-picker">
      <label htmlFor={`${idPrefix}-name`}>
        <span>{nameLabel}</span>
        <input
          id={`${idPrefix}-name`}
          ref={inputRef}
          value={name}
          autoComplete="off"
          onChange={event => {
            onNameChange(event.target.value);
            onSelectedProductChange(null);
          }}
          aria-describedby={`${idPrefix}-search-status`}
        />
      </label>

      <p id={`${idPrefix}-search-status`} className="product-picker-status" role="status" aria-live="polite">
        {!online ? 'Reconnect to search your household catalog.' : searching ? 'Searching catalog…' : ''}
      </p>

      {matches.length > 0 && (
        <fieldset className="product-picker-options">
          <legend>Use an existing product</legend>
          {matches.map(product => (
            <label key={product._id}>
              <input
                type="radio"
                name={`${idPrefix}-catalog-product`}
                value={product._id}
                checked={selectedProduct?._id === product._id}
                onChange={() => {
                  onSelectedProductChange(product);
                  onNameChange(product.name);
                  if (product.category) onCategoryChange(product.category);
                  if (product.unit) onUnitChange(product.unit);
                }}
              />
              <span>{productLabel(product)}</span>
            </label>
          ))}
          {selectedProduct && (
            <button type="button" className="product-picker-create" onClick={() => onSelectedProductChange(null)}>
              Create a new product instead
            </button>
          )}
        </fieldset>
      )}

      {!selectedProduct && (
        <div className="product-picker-details">
          <label htmlFor={`${idPrefix}-category`}>
            <span>Category</span>
            <input id={`${idPrefix}-category`} value={category} onChange={event => onCategoryChange(event.target.value)} />
          </label>
          <label htmlFor={`${idPrefix}-unit`}>
            <span>Unit</span>
            <input id={`${idPrefix}-unit`} value={unit} onChange={event => onUnitChange(event.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
