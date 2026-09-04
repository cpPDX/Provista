import { apiFetch } from '../api/http';
import { queryClient } from '../app/queryClient';
import type {
  FavoriteMeal,
  MealAllocationProjection,
  MealPlan,
  MealPlanSettings,
  MealReconciliationStatus,
  MealShoppingPreview,
  PlanDay
} from './types';

export const mealPlanQueryKey = (weekStart: string) => ['meal-plan', weekStart] as const;
export const mealAllocationQueryKey = (weekStart: string) => ['meal-allocations', weekStart] as const;
export const mealReconciliationQueryKey = (mealInstanceId: string) => ['meal-reconciliation', mealInstanceId] as const;
export const mealPlanSettingsQueryKey = ['meal-plan-settings'] as const;
export const favoriteMealsQueryKey = ['meal-plan-favorites'] as const;

function invalidateMealPlanCache(weekStart: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: mealPlanQueryKey(weekStart), refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: mealAllocationQueryKey(weekStart) })
  ]);
}

export function loadMealPlan(weekStart: string) {
  return apiFetch<MealPlan>(`/api/meal-plan?weekStart=${encodeURIComponent(weekStart)}`);
}

export function loadMealAllocations(weekStart: string) {
  return apiFetch<MealAllocationProjection>(`/api/inventory/meal-projection?weekStart=${encodeURIComponent(weekStart)}`);
}

export function loadMealReconciliation(mealInstanceId: string) {
  return apiFetch<MealReconciliationStatus>(`/api/inventory/meal-reconciliation/${encodeURIComponent(mealInstanceId)}`);
}

export async function reverseMealPantry(mealInstanceId: string) {
  const result = await apiFetch<{ status: MealReconciliationStatus }>(
    `/api/inventory/meal-reconciliation/${encodeURIComponent(mealInstanceId)}/reverse`,
    { method: 'POST' }
  );
  queryClient.setQueryData(mealReconciliationQueryKey(mealInstanceId), result.status);
  await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  return result.status;
}

export async function updateMealPantry(mealInstanceId: string) {
  const result = await apiFetch<{ status: MealReconciliationStatus }>(
    `/api/inventory/meal-reconciliation/${encodeURIComponent(mealInstanceId)}/update-pantry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() })
    }
  );
  queryClient.setQueryData(mealReconciliationQueryKey(mealInstanceId), result.status);
  await queryClient.invalidateQueries({ queryKey: ['inventory'] });
  return result.status;
}

export async function saveMealPlan(payload: {
  weekStart: string;
  days: PlanDay[];
  produceNotes: string;
  shoppingNotes: string;
}) {
  const saved = await apiFetch<MealPlan>('/api/meal-plan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await invalidateMealPlanCache(payload.weekStart);
  return saved;
}

export function loadMealPlanSettings() {
  return apiFetch<MealPlanSettings>('/api/meal-plan/settings');
}

export function saveMealPlanSettings(settings: Partial<MealPlanSettings>) {
  return apiFetch<MealPlanSettings>('/api/meal-plan/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
}

export async function copyPreviousWeek(weekStart: string) {
  const copied = await apiFetch<MealPlan>('/api/meal-plan/copy-previous', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart })
  });
  await invalidateMealPlanCache(weekStart);
  return copied;
}

export function loadFavoriteMeals() {
  return apiFetch<FavoriteMeal[]>('/api/meal-plan/favorites');
}

export function saveFavoriteMeal(payload: { name: string; notes: string }) {
  return apiFetch<FavoriteMeal>('/api/meal-plan/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function updateFavoriteMeal(id: string, payload: { name: string; notes: string }) {
  return apiFetch<FavoriteMeal>(`/api/meal-plan/favorites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function useFavoriteMeal(id: string) {
  return apiFetch<FavoriteMeal>(`/api/meal-plan/favorites/${id}/use`, { method: 'POST' });
}

export function deleteFavoriteMeal(id: string) {
  return apiFetch<{ success: true }>(`/api/meal-plan/favorites/${id}`, { method: 'DELETE' });
}

export function previewMealShoppingNeeds(notes: string) {
  return apiFetch<MealShoppingPreview>('/api/meal-plan/shopping-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes })
  });
}

export function addMealShoppingNeeds(items: Array<{ itemId: string; quantity: number }>) {
  return apiFetch<{ addedCount: number; skippedCount: number }>('/api/shopping-list/from-meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
}
