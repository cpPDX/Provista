import { apiFetch } from '../api/http';
import type {
  BarcodeLookupResult,
  CatalogProductInput,
  ExternalPriceRefreshResult,
  ProductPriceContext,
  ProductRef
} from './types';

export async function loadCatalog(): Promise<ProductRef[]> {
  return apiFetch<ProductRef[]>('/api/items');
}

export async function searchCatalog(search: string): Promise<ProductRef[]> {
  const query = new URLSearchParams({ search });
  return apiFetch<ProductRef[]>(`/api/items?${query.toString()}`);
}

export async function createCatalogProduct(input: CatalogProductInput): Promise<ProductRef> {
  return apiFetch<ProductRef>('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export async function updateCatalogProduct(itemId: string, input: Partial<CatalogProductInput>): Promise<ProductRef> {
  return apiFetch<ProductRef>(`/api/items/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export async function mergeCatalogProduct(sourceId: string, targetId: string): Promise<ProductRef> {
  const result = await apiFetch<{ success: boolean; target: ProductRef }>(`/api/items/${sourceId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId })
  });
  return result.target;
}

export async function deleteCatalogProduct(itemId: string): Promise<void> {
  await apiFetch(`/api/items/${itemId}`, { method: 'DELETE' });
}

export async function removeCatalogAlias(itemId: string, aliasId: string): Promise<void> {
  await apiFetch(`/api/items/${itemId}/aliases/${aliasId}`, { method: 'DELETE' });
}

export async function lookupBarcode(upc: string): Promise<BarcodeLookupResult> {
  return apiFetch<BarcodeLookupResult>(`/api/barcode/${encodeURIComponent(upc)}`);
}

export async function enrichLocalBarcodeProduct(upc: string): Promise<{ item: ProductRef; filledFields: string[] }> {
  return apiFetch<{ item: ProductRef; filledFields: string[] }>(`/api/barcode/${encodeURIComponent(upc)}/enrich-local`, {
    method: 'POST'
  });
}

export async function loadProductPriceContext(itemId: string, storeId?: string | null): Promise<ProductPriceContext> {
  const query = new URLSearchParams();
  if (storeId) query.set('storeId', storeId);
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiFetch<ProductPriceContext>(`/api/external-prices/context/${itemId}${suffix}`);
}

export async function refreshProductExternalPrice(itemId: string, storeId?: string | null): Promise<ExternalPriceRefreshResult> {
  return apiFetch<ExternalPriceRefreshResult>(`/api/external-prices/refresh-item/${itemId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: storeId || null })
  });
}