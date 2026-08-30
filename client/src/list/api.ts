import { ApiError, apiFetch } from '../api/http';
import {
  cacheShoppingItem,
  deleteCachedShoppingItem,
  queueShoppingWrite,
  readCachedShoppingList,
  replaceCachedShoppingList
} from './storage';
import type { ShoppingListItem } from './types';

export interface ShoppingMutationResult {
  data: ShoppingListItem;
  queued: boolean;
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
