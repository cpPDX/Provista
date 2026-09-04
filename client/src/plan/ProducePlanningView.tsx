import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPantryItem, loadPantry } from '../pantry/api';
import { pantryProduct, pantryProductName, pantryUnit, type PantryItem } from '../pantry/types';
import { createCatalogProduct, searchCatalog } from '../products/api';
import type { ProductRef } from '../products/types';
import { useToast } from '../shell/ToastProvider';
import {
  loadMealAllocations,
  loadMealPlanSettings,
  mealAllocationQueryKey,
  mealPlanSettingsQueryKey
} from './api';
import './producePlanning.css';

const pantryQueryKey = ['pantry'] as const;

function isoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeWeekStart(date: Date, weekStartDay: number) {
  const copy = new Date(date);
  let offset = copy.getDay() - weekStartDay;
  if (offset < 0) offset += 7;
  copy.setDate(copy.getDate() - offset);
  return isoDate(copy);
}

function itemId(item: PantryItem) {
  return typeof item.itemId === 'string' ? item.itemId : String(item.itemId?._id || '');
}

function isProduce(item: PantryItem) {
  return String(pantryProduct(item)?.category || '').trim().toLowerCase() === 'produce';
}

function statusRank(item: PantryItem) {
  if (item.stockStatus === 'out') return 0;
  if (item.stockStatus === 'low') return 1;
  return 2;
}

function statusText(item: PantryItem) {
  if (item.trackingMode === 'simple') {
    return item.stockStatus === 'out' ? 'Out' : item.stockStatus === 'low' ? 'Running low' : 'Have';
  }
  const unit = pantryUnit(item);
  return `${Number(item.quantity) || 0}${unit ? ` ${unit}` : ''} on hand`;
}

export function ProducePlanningView() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const pantryQuery = useQuery({ queryKey: pantryQueryKey, queryFn: loadPantry });
  const settingsQuery = useQuery({ queryKey: mealPlanSettingsQueryKey, queryFn: loadMealPlanSettings });
  const weekStart = settingsQuery.data
    ? normalizeWeekStart(new Date(), settingsQuery.data.weekStartDay)
    : '';
  const allocationQuery = useQuery({
    queryKey: mealAllocationQueryKey(weekStart),
    queryFn: () => loadMealAllocations(weekStart),
    enabled: Boolean(weekStart)
  });
  const [name, setName] = useState('');
  const [candidates, setCandidates] = useState<ProductRef[]>([]);
  const [busy, setBusy] = useState(false);

  const produce = useMemo(() => (pantryQuery.data || [])
    .filter(isProduce)
    .sort((left, right) => statusRank(left) - statusRank(right) || pantryProductName(left).localeCompare(pantryProductName(right))), [pantryQuery.data]);

  const projectionByItem = useMemo(() => new Map(
    (allocationQuery.data?.itemSummaries || []).map(summary => [String(summary.itemId), summary])
  ), [allocationQuery.data]);

  const trackProduct = async (product: ProductRef) => {
    const current = pantryQuery.data || [];
    if (current.some(item => itemId(item) === String(product._id))) {
      showToast(`${product.name} is already in Pantry.`);
      setName('');
      setCandidates([]);
      return;
    }

    setBusy(true);
    try {
      await createPantryItem({ itemId: product._id, trackingMode: 'simple', stockStatus: 'have' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pantryQueryKey }),
        weekStart ? queryClient.invalidateQueries({ queryKey: mealAllocationQueryKey(weekStart) }) : Promise.resolve()
      ]);
      showToast(`${product.name} is now tracked in Pantry.`, { tone: 'success' });
      setName('');
      setCandidates([]);
    } catch (error) {
      console.error(error);
      showToast('Could not add that produce to Pantry.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const resolveProduce = async () => {
    const requestedName = name.trim();
    if (!requestedName || busy) return;
    setBusy(true);
    setCandidates([]);
    try {
      const matches = await searchCatalog(requestedName);
      if (matches.length === 1) {
        setBusy(false);
        await trackProduct(matches[0]);
        return;
      }
      if (matches.length > 1) {
        setCandidates(matches.slice(0, 6));
        return;
      }

      const created = await createCatalogProduct({
        name: requestedName,
        category: 'Produce',
        unit: 'each'
      });
      setBusy(false);
      await trackProduct(created);
    } catch (error) {
      console.error(error);
      showToast('Could not look up that produce item.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plan-produce-planning" aria-labelledby="plan-produce-planning-title">
      <header>
        <div>
          <h2 id="plan-produce-planning-title">Produce to use this week</h2>
          <p>From Pantry. Plan with what you already have instead of keeping a second produce list.</p>
        </div>
      </header>

      {pantryQuery.isPending ? (
        <div className="plan-produce-state" aria-busy="true">Checking Pantry…</div>
      ) : pantryQuery.isError ? (
        <div className="plan-produce-state">
          <strong>Couldn’t load Pantry produce</strong>
          <button type="button" className="plan-link-button" onClick={() => void pantryQuery.refetch()}>Try again</button>
        </div>
      ) : produce.length ? (
        <div className="plan-produce-items">
          {produce.map(item => {
            const projection = projectionByItem.get(itemId(item));
            const unit = projection?.unit || pantryUnit(item);
            const planned = Number(projection?.plannedQuantity) || 0;
            const projected = projection?.projectedQuantity;
            const shortage = Number(projection?.shoppingQuantity) || 0;
            return (
              <article key={item._id} data-pantry-id={item._id}>
                <div>
                  <strong>{pantryProductName(item)}</strong>
                  <span>{statusText(item)}</span>
                </div>
                {projection && (
                  <small>
                    {planned > 0 ? `Planned ${planned}${unit ? ` ${unit}` : ''}` : 'Not planned yet'}
                    {projected != null ? ` · ${projected}${unit ? ` ${unit}` : ''} projected` : ''}
                    {shortage > 0 ? ` · Buy ${shortage}${unit ? ` ${unit}` : ''}` : ''}
                  </small>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="plan-produce-state">
          <strong>No produce is tracked in Pantry yet</strong>
          <span>Add something you actually have. It will stay one Pantry item everywhere in Provista.</span>
        </div>
      )}

      <div className="plan-produce-add">
        <label htmlFor="plan-produce-add-name">Add produce you already have</label>
        <div>
          <input
            id="plan-produce-add-name"
            value={name}
            placeholder="e.g. spinach"
            onChange={event => { setName(event.target.value); setCandidates([]); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void resolveProduce(); } }}
          />
          <button type="button" className="shell-button shell-button-secondary" disabled={!name.trim() || busy} onClick={() => void resolveProduce()}>
            {busy ? 'Adding…' : 'Add to Pantry'}
          </button>
        </div>
      </div>

      {candidates.length > 1 && (
        <div className="plan-produce-candidates" role="group" aria-label="Choose matching produce">
          <strong>Which item did you mean?</strong>
          {candidates.map(product => (
            <button type="button" key={product._id} disabled={busy} onClick={() => void trackProduct(product)}>
              <span>{product.name}</span>
              <small>{[product.brand, product.category, product.unit].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
