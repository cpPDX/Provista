import type { ProductRef } from '../products/types';

export type PantryTrackingMode = 'simple' | 'exact';
export type PantryStockStatus = 'have' | 'low' | 'out';

export interface PantryItem {
  _id: string;
  itemId: ProductRef | string | null;
  trackingMode: PantryTrackingMode;
  stockStatus: PantryStockStatus;
  quantity: number;
  lowStockThreshold?: number | null;
  unit?: string;
  notes?: string;
  lastUpdated?: string;
}

export interface PantryTrackingInput {
  trackingMode: PantryTrackingMode;
  stockStatus?: PantryStockStatus;
  quantity?: number;
  lowStockThreshold?: number | null;
  unit?: string;
  notes?: string;
}

export interface CreatePantryItemInput extends PantryTrackingInput {
  itemId: string;
}

export function pantryProduct(item: PantryItem): ProductRef | null {
  return item.itemId && typeof item.itemId !== 'string' ? item.itemId : null;
}

export function pantryProductName(item: PantryItem): string {
  return pantryProduct(item)?.name || 'Item';
}

export function pantryUnit(item: PantryItem): string {
  return item.unit || pantryProduct(item)?.unit || '';
}

export function exactPantryStatus(item: Pick<PantryItem, 'quantity' | 'lowStockThreshold'>): PantryStockStatus {
  const quantity = Number(item.quantity) || 0;
  if (quantity <= 0) return 'out';
  if (item.lowStockThreshold != null && quantity <= Number(item.lowStockThreshold)) return 'low';
  return 'have';
}
