import { ApiError, apiFetch } from '../api/http';
export { createCatalogProduct, searchCatalog } from '../products/api';
import {
  cacheShoppingItem,
  deleteCachedShoppingItem,
  queueShoppingWrite,
  readCachedShoppingList,
  replaceCachedShoppingList
} from './storage';
import type { ProductRef, ShoppingListItem, StoreRef } from './types';

export interface ShoppingMutationResult {
  data: ShoppingListItem;
  queued: boolean;
}

export interface MatchCandidate extends ProductRef {
  score?: number;
  matchSource?: string;
}

export interface ShoppingMatchSuggestion {
  sourceText: string;
  quantity: number;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched';
  confidenceScore?: number;
  confidenceGap?: number;
  matchSource?: string;
  duplicateInInput?: boolean;
  item?: ProductRef | null;
  candidates?: MatchCandidate[];
}

export interface ShoppingMatchResult {
  parsedCount: number;
  matchedCount: number;
  ambiguousCount: number;
  unmatchedCount: number;
  suggestions: ShoppingMatchSuggestion[];
}

export interface ShoppingTripResult {
  tripId: string;
  completedAt: string;
  total: number;
  itemCount: number;
  pricedItemCount: number;
  missingPriceCount: number;
  pantryUpdated: boolean;
  pantryItemCount: number;
  approvedPriceCount: number;
  pendingPriceCount: number;
  lowStockCount: number;
  idempotent: boolean;
}

export interface StoreSectionsResult {
  defaults: string[];
  suggestions: string[];
  saved: Array<{ itemId: string; storeSection: string }>;
}

function shouldUseOfflineFallback(error: unknown): boolean {
  return !navigator.onLine ||
    error instanceof TypeError ||
    (error instanceof ApiError && error.status === 503);
}

export async function loadShoppingList(): Promise<ShoppingListItem[]> {
  try {
    const items = await apiFetch<ShoppingListItem[]>('/api/shopping-list');
    await replaceCachedShoppingList(items).catch(() => undefined);
    return items;
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    const cached = await readCachedShoppingList().catch(() => []);
    if (cached.length) return cached;
    throw new Error('Shopping List is not available offline yet. Reconnect once to save it on this device.');
  }
}

export async function addShoppingListItem(
  product: ProductRef,
  quantity: number,
  storeId?: string | null
): Promise<ShoppingMutationResult> {
  const payload = {
    itemId: product._id,
    quantity,
    ...(storeId ? { storeId } : {})
  };

  try {
    const response = await apiFetch<ShoppingListItem>('/api/shopping-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await cacheShoppingItem(response).catch(() => undefined);
    return { data: response, queued: false };
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    const localId = `local-${crypto.randomUUID()}`;
    const optimistic: ShoppingListItem = {
      _id: localId,
      itemId: product,
      storeId: storeId || null,
      quantity,
      checked: false,
      addedAt: new Date().toISOString()
    };
    await cacheShoppingItem(optimistic);
    await queueShoppingWrite({
      operation: 'CREATE',
      payload,
      path: '/shopping-list',
      method: 'POST',
      localId
    });
    return { data: optimistic, queued: true };
  }
}

export async function updateShoppingListItem(
  id: string,
  patch: Partial<Pick<ShoppingListItem, 'checked' | 'quantity' | 'storeId'>>,
  snapshot: ShoppingListItem
): Promise<ShoppingMutationResult> {
  try {
    const response = await apiFetch<ShoppingListItem>(`/api/shopping-list/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const merged = { ...snapshot, ...response, ...patch };
    await cacheShoppingItem(merged).catch(() => undefined);
    return { data: merged, queued: false };
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    const optimistic = { ...snapshot, ...patch };
    await cacheShoppingItem(optimistic);
    await queueShoppingWrite({
      operation: 'UPDATE',
      payload: patch,
      path: `/shopping-list/${id}`,
      method: 'PUT'
    });
    return { data: optimistic, queued: true };
  }
}

export async function deleteShoppingListItem(id: string): Promise<{ queued: boolean }> {
  try {
    await apiFetch(`/api/shopping-list/${id}`, { method: 'DELETE' });
    await deleteCachedShoppingItem(id).catch(() => undefined);
    return { queued: false };
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    await deleteCachedShoppingItem(id);
    await queueShoppingWrite({
      operation: 'DELETE',
      payload: null,
      path: `/shopping-list/${id}`,
      method: 'DELETE'
    });
    return { queued: true };
  }
}

export async function matchShoppingText(text: string): Promise<ShoppingMatchResult> {
  return apiFetch<ShoppingMatchResult>('/api/items/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

export async function addCatalogAlias(itemId: string, text: string): Promise<void> {
  await apiFetch(`/api/items/${itemId}/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source: 'user-entry' })
  });
}

export async function loadStores(): Promise<StoreRef[]> {
  return apiFetch<StoreRef[]>('/api/stores');
}

export async function loadStoreSections(): Promise<StoreSectionsResult> {
  return apiFetch<StoreSectionsResult>('/api/item-sections');
}

export async function updateStoreSection(itemId: string, storeSection: string): Promise<{ _id: string; storeSection: string }> {
  return apiFetch<{ _id: string; storeSection: string }>(`/api/item-sections/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeSection })
  });
}

export async function completeShoppingTrip(input: {
  idempotencyKey: string;
  purchases: Array<{ listItemId: string; price: number | null; storeId: string }>;
  addToPantry: boolean;
}): Promise<ShoppingTripResult> {
  return apiFetch<ShoppingTripResult>('/api/shopping-list/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}
