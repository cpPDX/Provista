import { apiFetch } from '../api/http';

export interface InsightItem {
  _id: string;
  name: string;
  brand?: string;
  unit?: string;
  size?: string;
  category?: string;
  isOrganic?: boolean;
}

export interface InsightStore {
  _id: string;
  name: string;
  location?: string;
}

export interface PriceEntryRecord {
  _id: string;
  itemId: InsightItem | string;
  storeId: InsightStore | string;
  regularPrice: number;
  salePrice?: number | null;
  couponAmount?: number | null;
  couponCode?: string | null;
  quantity: number;
  finalPrice: number;
  pricePerUnit: number;
  date: string;
  status?: 'approved' | 'pending';
}

export interface SpendBreakdownItem {
  name: string;
  amount: number;
  storeId?: string | null;
}

export interface SpendMonthRecord {
  month: string;
  total: number;
  byCategory: SpendBreakdownItem[];
  byStore: SpendBreakdownItem[];
}

export interface SpendSummaryRecord {
  month: string;
  total: number;
}

export interface CreatePriceInput {
  itemId: string;
  storeId: string;
  regularPrice: number;
  salePrice?: number | null;
  couponAmount?: number | null;
  couponCode?: string | null;
  quantity: number;
  date: string;
  source: 'manual';
}

export async function loadInsightItems() {
  return apiFetch<InsightItem[]>('/api/items');
}

export async function loadInsightStores() {
  return apiFetch<InsightStore[]>('/api/stores');
}

export async function loadPrices(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);
  return apiFetch<PriceEntryRecord[]>(`/api/prices${query.size ? `?${query.toString()}` : ''}`);
}

export async function createPrice(input: CreatePriceInput) {
  return apiFetch<PriceEntryRecord>('/api/prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export async function loadPendingPrices() {
  return apiFetch<PriceEntryRecord[]>('/api/prices/pending');
}

export async function approvePrice(id: string) {
  return apiFetch<PriceEntryRecord>(`/api/prices/${id}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
}

export async function rejectPrice(id: string) {
  return apiFetch<{ success: boolean }>(`/api/prices/${id}/reject`, { method: 'DELETE' });
}

export async function loadSpendMonth(month: string) {
  return apiFetch<SpendMonthRecord>(`/api/spend?month=${encodeURIComponent(month)}`);
}

export async function loadSpendSummary() {
  return apiFetch<SpendSummaryRecord[]>('/api/spend/summary');
}
