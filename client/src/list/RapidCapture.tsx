import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useToast } from '../shell/ToastProvider';
import {
  addCatalogAlias,
  addShoppingListItem,
  createCatalogProduct,
  matchShoppingText,
  searchCatalog,
  updateShoppingListItem,
  type ShoppingMatchResult,
  type ShoppingMatchSuggestion
} from './api';
import { entityId, type ProductRef, type ShoppingListItem } from './types';

const MAX_QUANTITY = 99;

interface ReviewToken {
  name: string;
  quantity: number;
  candidates?: ProductRef[];
}

interface RapidCaptureProps {
  items: ShoppingListItem[];
  online: boolean;
  onListChanged: () => void | Promise<void>;
}

interface AddBatchResult {
  addedCount: number;
  queuedCount: number;
  failed: ReviewToken[];
}

function serializeToken(token: ReviewToken) {
  return token.quantity === 1 ? token.name : `${token.name} x${token.quantity}`;
}

function productName(product: ProductRef) {
  return [product.name, product.brand].filter(Boolean).join(' · ');
}

function aggregateMatchedSuggestions(suggestions: ShoppingMatchSuggestion[]) {
  const byItemId = new Map<string, { item: ProductRef; quantity: number; sourceNames: string[] }>();
  suggestions.forEach(suggestion => {
    if (suggestion.matchStatus !== 'matched' || !suggestion.item?._id) return;
    const key = suggestion.item._id;
    const existing = byItemId.get(key);
    if (existing) {
      existing.quantity += Number(suggestion.quantity) || 1;
      existing.sourceNames.push(suggestion.sourceText);
    } else {
      byItemId.set(key, {
        item: suggestion.item,
        quantity: Number(suggestion.quantity) || 1,
        sourceNames: [suggestion.sourceText]
      });
    }
  });
  return [...byItemId.values()];
}

function unresolvedTokens(suggestions: ShoppingMatchSuggestion[]): ReviewToken[] {
  return suggestions
    .filter(suggestion => suggestion.matchStatus !== 'matched')
    .map(suggestion => ({
      name: suggestion.sourceText,
      quantity: Number(suggestion.quantity) || 1,
      candidates: suggestion.candidates?.slice(0, 5)
    }));
}

export function RapidCapture({ items, online, onListChanged }: RapidCaptureProps) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const detailNameRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ message: string; tone?: 'success' | 'warning' }>({ message: '' });
  const [matching, setMatching] = useState(false);
  const [capture, setCapture] = useState<ShoppingMatchResult | null>(null);
  const [reviewTokens, setReviewTokens] = useState<ReviewToken[]>([]);
  const [detailName, setDetailName] = useState('');
  const [detailQuantity, setDetailQuantity] = useState(1);
  const [detailCategory, setDetailCategory] = useState('Other');
  const [detailUnit, setDetailUnit] = useState('each');
  const [catalogMatches, setCatalogMatches] = useState<ProductRef[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [detailSaving, setDetailSaving] = useState(false);

  const currentToken = reviewTokens[0] || null;

  useEffect(() => {
    if (!currentToken) return;
    setDetailName(currentToken.name);
    setDetailQuantity(currentToken.quantity);
    setDetailCategory('Other');
    setDetailUnit('each');
    setSelectedProductId('');
    setCatalogMatches(currentToken.candidates || []);
    window.setTimeout(() => detailNameRef.current?.focus(), 0);
  }, [currentToken?.name, currentToken?.quantity]);

  useEffect(() => {
    if (!currentToken || !online || detailName.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      void searchCatalog(detailName.trim())
        .then(results => {
          const merged = new Map<string, ProductRef>();
          (currentToken.candidates || []).forEach(product => merged.set(product._id, product));
          results.forEach(product => merged.set(product._id, product));
          setCatalogMatches([...merged.values()].slice(0, 8));
        })
        .catch(error => console.info('Catalog search unavailable:', error));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [currentToken, detailName, online]);

  const addProductQuantity = async (product: ProductRef, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      throw new Error(`Quantity must be between 1 and ${MAX_QUANTITY}`);
    }

    const existing = items.find(item => !item.checked && entityId(item.itemId) === product._id);
    if (existing) {
      const nextQuantity = Number(existing.quantity || 0) + quantity;
      if (nextQuantity > MAX_QUANTITY) throw new Error(`Quantity cannot exceed ${MAX_QUANTITY}`);
      return updateShoppingListItem(existing._id, { quantity: nextQuantity }, existing);
    }
    return addShoppingListItem(product, quantity);
  };

  const addMatchedSuggestions = async (suggestions: ShoppingMatchSuggestion[]): Promise<AddBatchResult> => {
    const matched = aggregateMatchedSuggestions(suggestions);
    const failed: ReviewToken[] = [];
    let addedCount = 0;
    let queuedCount = 0;

    for (const match of matched) {
      try {
        const result = await addProductQuantity(match.item, match.quantity);
        addedCount += 1;
        if (result.queued) queuedCount += 1;
      } catch (error) {
        console.error(error);
        failed.push({ name: match.sourceNames[0], quantity: match.quantity, candidates: [match.item] });
      }
    }

    if (addedCount) await onListChanged();
    return { addedCount, queuedCount, failed };
  };

  const submitCapture = async (event: FormEvent) => {
    event.preventDefault();
    const input = text.trim();
    if (!input) return;
    if (!online) {
      setStatus({ message: 'Reconnect to match grocery names against your household catalog.', tone: 'warning' });
      return;
    }

    setMatching(true);
    setCapture(null);
    setReviewTokens([]);
    setStatus({ message: 'Matching your list…' });

    try {
      const result = await matchShoppingText(input);
      const suggestions = result.suggestions || [];
      const matched = suggestions.filter(item => item.matchStatus === 'matched');
      const unresolved = suggestions.filter(item => item.matchStatus !== 'matched');

      if (suggestions.length === 1 && matched.length === 1 && unresolved.length === 0) {
        const batch = await addMatchedSuggestions(suggestions);
        if (batch.failed.length) {
          setReviewTokens(batch.failed);
          setText(batch.failed.map(serializeToken).join(', '));
          setStatus({ message: 'That item needs details before it can be added.', tone: 'warning' });
          return;
        }
        setText('');
        setStatus({ message: batch.queuedCount ? 'Added 1 item offline. It will sync when you reconnect.' : 'Added 1 item.', tone: 'success' });
        showToast(batch.queuedCount ? 'Added offline. Will sync when you reconnect.' : 'Added 1 item to the list', { tone: 'success' });
        inputRef.current?.focus();
        return;
      }

      setCapture(result);
      setStatus(unresolved.length
        ? { message: `${unresolved.length} ${unresolved.length === 1 ? 'item needs' : 'items need'} review before the list changes.`, tone: 'warning' }
        : { message: `Review ${matched.length} matched items before adding.` });
    } catch (error) {
      console.error(error);
      setStatus({ message: 'Could not match those items. Try again.', tone: 'warning' });
    } finally {
      setMatching(false);
    }
  };

  const confirmCapture = async () => {
    if (!capture) return;
    setMatching(true);
    try {
      const unresolved = unresolvedTokens(capture.suggestions);
      const batch = await addMatchedSuggestions(capture.suggestions);
      const nextReview = [...unresolved, ...batch.failed];
      setCapture(null);
      setReviewTokens(nextReview);
      setText(nextReview.map(serializeToken).join(', '));

      if (nextReview.length) {
        const addedText = batch.addedCount ? `Added ${batch.addedCount}. ` : '';
        setStatus({
          message: `${addedText}${nextReview.length} ${nextReview.length === 1 ? 'item needs' : 'items need'} details.`,
          tone: 'warning'
        });
        if (batch.addedCount) showToast(`Added ${batch.addedCount}; ${nextReview.length} need details`);
      } else {
        setText('');
        setStatus({ message: `Added ${batch.addedCount} ${batch.addedCount === 1 ? 'item' : 'items'}.`, tone: 'success' });
        showToast(`Added ${batch.addedCount} ${batch.addedCount === 1 ? 'item' : 'items'} to the list`, { tone: 'success' });
        inputRef.current?.focus();
      }
    } finally {
      setMatching(false);
    }
  };

  const closeDetails = () => {
    setReviewTokens([]);
    setStatus({ message: 'Items needing details are still in the Add groceries field.', tone: 'warning' });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentToken || detailSaving) return;
    if (!online) {
      setStatus({ message: 'Reconnect before resolving a new catalog item.', tone: 'warning' });
      return;
    }

    setDetailSaving(true);
    try {
      let product = catalogMatches.find(candidate => candidate._id === selectedProductId) || null;
      if (!product) {
        const name = detailName.trim();
        if (!name) throw new Error('Product name is required');
        product = await createCatalogProduct({
          name,
          category: detailCategory.trim() || 'Other',
          unit: detailUnit.trim() || 'each'
        });
      }

      const result = await addProductQuantity(product, detailQuantity);
      await onListChanged();
      if (currentToken.name.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
        void addCatalogAlias(product._id, currentToken.name).catch(error => {
          console.info('Could not remember grocery alias:', error);
        });
      }

      const remaining = reviewTokens.slice(1);
      setReviewTokens(remaining);
      setText(remaining.map(serializeToken).join(', '));
      if (remaining.length) {
        setStatus({ message: `${remaining.length} ${remaining.length === 1 ? 'item still needs' : 'items still need'} details.`, tone: 'warning' });
      } else {
        setStatus({ message: result.queued ? 'All items added; the last change will sync when you reconnect.' : 'All items added.', tone: 'success' });
        showToast('All groceries added', { tone: 'success' });
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (error) {
      console.error(error);
      setStatus({ message: error instanceof Error ? error.message : 'Could not add that item.', tone: 'warning' });
    } finally {
      setDetailSaving(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDetails();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
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

  const previewSummary = useMemo(() => {
    if (!capture) return { matched: 0, unresolved: 0 };
    const matched = capture.suggestions.filter(item => item.matchStatus === 'matched').length;
    return { matched, unresolved: capture.suggestions.length - matched };
  }, [capture]);

  return (
    <>
      <form className="react-rapid-capture" onSubmit={submitCapture}>
        <label htmlFor="react-rapid-list-input">Add groceries</label>
        <div className="react-rapid-row">
          <textarea
            id="react-rapid-list-input"
            ref={inputRef}
            rows={1}
            value={text}
            disabled={matching}
            placeholder="Milk, eggs, 2 cans black beans…"
            aria-describedby="react-rapid-hint react-rapid-status"
            onChange={event => {
              setText(event.target.value);
              if (capture) setCapture(null);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" className="shell-button shell-button-primary" disabled={matching || !text.trim()}>
            {matching ? 'Matching…' : 'Add to list'}
          </button>
        </div>
        <div className="react-rapid-meta">
          <span id="react-rapid-hint">Type several items at once. Separate with commas; quantities can be natural language or x2.</span>
          <span id="react-rapid-status" role="status" aria-live="polite" data-state={status.tone || ''}>{status.message}</span>
          {reviewTokens.length > 0 && (
            <button type="button" className="react-list-clear-filter" onClick={() => setReviewTokens(tokens => [...tokens])}>
              Review {reviewTokens.length} {reviewTokens.length === 1 ? 'item' : 'items'} with details
            </button>
          )}
        </div>

        {capture && (
          <div className="react-rapid-preview" aria-label="Review groceries before adding">
            <strong>Review before adding</strong>
            <ul>
              {capture.suggestions.map((suggestion, index) => {
                const quantity = Number(suggestion.quantity) || 1;
                const names = suggestion.candidates?.slice(0, 2).map(candidate => candidate.name).filter(Boolean) || [];
                const label = suggestion.matchStatus === 'matched'
                  ? (suggestion.item?.name || suggestion.sourceText)
                  : suggestion.sourceText;
                const state = suggestion.matchStatus === 'matched'
                  ? (suggestion.matchSource === 'alias' ? 'Remembered match' : 'Matched')
                  : suggestion.matchStatus === 'ambiguous'
                    ? (names.length ? `Needs a choice: ${names.join(' or ')}` : 'Needs a choice')
                    : 'Needs details';
                return (
                  <li key={`${suggestion.sourceText}-${index}`} className={`react-rapid-${suggestion.matchStatus}`}>
                    <span>{label}{quantity > 1 ? ` × ${quantity}` : ''}</span>
                    <small>{state}</small>
                  </li>
                );
              })}
            </ul>
            <div className="react-rapid-actions">
              <button type="button" className="shell-button shell-button-primary" disabled={matching} onClick={() => void confirmCapture()}>
                {previewSummary.matched && previewSummary.unresolved
                  ? `Add ${previewSummary.matched} & review ${previewSummary.unresolved}`
                  : previewSummary.matched
                    ? `Add ${previewSummary.matched} ${previewSummary.matched === 1 ? 'item' : 'items'}`
                    : `Review ${previewSummary.unresolved} ${previewSummary.unresolved === 1 ? 'item' : 'items'}`}
              </button>
              <button type="button" className="shell-button shell-button-secondary" onClick={() => { setCapture(null); inputRef.current?.focus(); }}>
                Edit
              </button>
            </div>
          </div>
        )}
      </form>

      {currentToken && (
        <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDetails(); }}>
          <div className="react-list-modal" role="dialog" aria-modal="true" aria-labelledby="react-list-details-title" onKeyDown={handleDialogKeyDown}>
            <form onSubmit={saveDetails}>
              <div className="react-list-modal-heading">
                <div>
                  <p className="react-list-eyebrow">Needs details</p>
                  <h2 id="react-list-details-title">Add with details</h2>
                </div>
                <button type="button" className="react-list-modal-close" aria-label="Close Add with details" onClick={closeDetails}>✕</button>
              </div>

              <label>
                <span>What do you need?</span>
                <input ref={detailNameRef} value={detailName} onChange={event => { setDetailName(event.target.value); setSelectedProductId(''); }} />
              </label>

              {catalogMatches.length > 0 && (
                <fieldset className="react-list-product-options">
                  <legend>Use an existing product</legend>
                  {catalogMatches.map(product => (
                    <label key={product._id}>
                      <input type="radio" name="catalog-product" value={product._id} checked={selectedProductId === product._id} onChange={() => setSelectedProductId(product._id)} />
                      <span>{productName(product)}{product.category ? ` · ${product.category}` : ''}</span>
                    </label>
                  ))}
                  <button type="button" className="react-list-clear-filter" onClick={() => setSelectedProductId('')}>Create a new product instead</button>
                </fieldset>
              )}

              {!selectedProductId && (
                <div className="react-list-detail-grid">
                  <label>
                    <span>Category</span>
                    <input value={detailCategory} onChange={event => setDetailCategory(event.target.value)} />
                  </label>
                  <label>
                    <span>Unit</span>
                    <input value={detailUnit} onChange={event => setDetailUnit(event.target.value)} />
                  </label>
                </div>
              )}

              <label>
                <span>Quantity</span>
                <input type="number" min="1" max={MAX_QUANTITY} step="1" value={detailQuantity} onChange={event => setDetailQuantity(Number(event.target.value))} />
              </label>

              <div className="react-list-modal-actions">
                <button type="button" className="shell-button shell-button-secondary" onClick={closeDetails}>Cancel</button>
                <button type="submit" className="shell-button shell-button-primary" disabled={detailSaving || !detailName.trim()}>
                  {detailSaving ? 'Adding…' : selectedProductId ? 'Add selected product' : 'Create & add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
