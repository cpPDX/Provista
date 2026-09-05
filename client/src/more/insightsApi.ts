import { apiFetch } from '../api/http';

export interface InsightItem {
  _id: string;
  name: string;
  brand?: string;
  unit?: string;
  size?: string | number | null;
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
  item?: InsightItem | null;
  store?: InsightStore | null;
  regularPrice: number;
  salePrice?: number | null;
  couponAmount?: number | null;
  couponCode?: string | null;
  quantity: number;
  finalPrice: number;
  pricePerUnit: number;
  date: string;
  notes?: string | null;
  status?: 'approved' | 'pending';
  submittedBy?: { _id?: string; name?: string } | string | null;
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

export interface RecordPriceInput {
  itemId?: string;
  item?: {
    name: string;
    category: string;
    unit: string;
    brand?: string;
    size?: number;
    isOrganic?: boolean;
  };
  storeId?: string;
  store?: {
    name: string;
    location?: string;
  };
  regularPrice: number;
  salePrice?: number | null;
  couponAmount?: number | null;
  couponCode?: string | null;
  quantity: number;
  date: string;
  notes?: string | null;
  source: 'manual' | 'csv';
  replaceSameDay?: boolean;
}

export interface RecordPriceResult {
  entry: PriceEntryRecord;
  createdItem: InsightItem | null;
  createdStore: InsightStore | null;
  replacedPriceEntryId: string | null;
}

export interface ApprovePriceInput {
  storeId?: string;
  regularPrice?: number;
  salePrice?: number | null;
  couponAmount?: number | null;
  couponCode?: string | null;
  quantity?: number;
  date?: string;
  notes?: string | null;
}

function normalizeCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
}

export async function loadInsightItems() {
  return apiFetch<InsightItem[]>('/api/items');
}

export async function loadInsightStores() {
  return apiFetch<InsightStore[]>('/api/stores');
}

export async function loadPrices(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch<PriceEntryRecord[]>(`/api/prices${query ? `?${query}` : ''}`);
}

export async function loadPriceComparison(itemId: string) {
  return apiFetch<PriceEntryRecord[]>(`/api/prices/compare/${encodeURIComponent(itemId)}`);
}

export async function recordPrice(input: RecordPriceInput) {
  return apiFetch<RecordPriceResult>('/api/grocery/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, date: normalizeCalendarDate(input.date) })
  });
}

export async function loadPendingPrices() {
  return apiFetch<PriceEntryRecord[]>('/api/prices/pending');
}

export async function approvePrice(id: string, input: ApprovePriceInput = {}) {
  return apiFetch<PriceEntryRecord>(`/api/prices/${id}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      ...(input.date ? { date: normalizeCalendarDate(input.date) } : {})
    })
  });
}

export async function rejectPrice(id: string) {
  return apiFetch<{ success: boolean }>(`/api/prices/${id}/reject`, { method: 'DELETE' });
}

export async function deletePrice(id: string) {
  return apiFetch<{ success: boolean }>(`/api/prices/${id}`, { method: 'DELETE' });
}

export async function loadSpendMonth(month: string) {
  return apiFetch<SpendMonthRecord>(`/api/spend?month=${encodeURIComponent(month)}`);
}

export async function loadSpendSummary() {
  return apiFetch<SpendSummaryRecord[]>('/api/spend/summary');
}
