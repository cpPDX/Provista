import { apiFetch } from '../api/http';
import type { CatalogProductInput, ProductRef } from './types';

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
