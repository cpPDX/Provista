import { apiFetch } from '../api/http';
import type { CreatePantryItemInput, PantryItem, PantryTrackingInput } from './types';

export async function loadPantry(): Promise<PantryItem[]> {
  return apiFetch<PantryItem[]>('/api/inventory');
}

export async function createPantryItem(input: CreatePantryItemInput): Promise<PantryItem> {
  return apiFetch<PantryItem>('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export async function updatePantryItem(id: string, patch: PantryTrackingInput): Promise<PantryItem> {
  return apiFetch<PantryItem>(`/api/inventory/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

export async function deletePantryItem(id: string): Promise<void> {
  await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' });
}
