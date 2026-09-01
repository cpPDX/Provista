import { apiFetch } from '../api/http';
import type {
  FavoriteMeal,
  MealPlan,
  MealPlanSettings,
  MealShoppingPreview,
  PlanDay
} from './types';

export const mealPlanQueryKey = (weekStart: string) => ['meal-plan', weekStart] as const;
export const mealPlanSettingsQueryKey = ['meal-plan-settings'] as const;
export const favoriteMealsQueryKey = ['meal-plan-favorites'] as const;

export function loadMealPlan(weekStart: string) {
  return apiFetch<MealPlan>(`/api/meal-plan?weekStart=${encodeURIComponent(weekStart)}`);
}

export function saveMealPlan(payload: {
  weekStart: string;
  days: PlanDay[];
  produceNotes: string;
  shoppingNotes: string;
}) {
  return apiFetch<MealPlan>('/api/meal-plan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
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

export function copyPreviousWeek(weekStart: string) {
  return apiFetch<MealPlan>('/api/meal-plan/copy-previous', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart })
  });
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
