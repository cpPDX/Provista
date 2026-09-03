import type { ProductRef } from '../products/types';
export type { ProductRef } from '../products/types';

export interface StoreRef {
  _id: string;
  name: string;
  location?: string;
}

export interface PriceOption {
  pricePerUnit: number;
  finalPrice?: number;
  quantity?: number;
  date?: string;
  ageDays?: number;
  isStale?: boolean;
  store?: StoreRef | null;
}

export interface PriceContext {
  usualStore?: StoreRef | null;
  additionalStore?: StoreRef | null;
  estimatedAdditionalStopSavings?: number;
  savingsThreshold?: number;
  freshnessDays?: number;
}

export interface ShoppingListItem {
  _id: string;
  itemId: ProductRef | string | null;
  storeId?: StoreRef | string | null;
  tripStore?: StoreRef | null;
  tripPrice?: PriceOption | null;
  latestSeenPrice?: PriceOption | null;
  priceOptions?: PriceOption[];
  priceContext?: PriceContext;
  quantity: number;
  checked: boolean;
  addedAt?: string;
}

export function entityId(value: { _id?: string } | string | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : String(value._id || '');
}

export function productFor(item: ShoppingListItem): ProductRef | null {
  return item.itemId && typeof item.itemId !== 'string' ? item.itemId : null;
}

export function productName(item: ShoppingListItem): string {
  return productFor(item)?.name || 'Unknown item';
}

export function preferredStoreId(item: ShoppingListItem): string {
  return entityId(item.storeId);
}

export function plannedStoreId(item: ShoppingListItem): string {
  return preferredStoreId(item) || entityId(item.tripStore);
}

export function plannedStoreName(item: ShoppingListItem): string {
  if (item.storeId && typeof item.storeId !== 'string') return item.storeId.name;
  return item.tripStore?.name || 'Any store';
}

export function usualStoreId(items: ShoppingListItem[]): string {
  const context = items.find(item => item.priceContext)?.priceContext;
  return entityId(context?.usualStore);
}
