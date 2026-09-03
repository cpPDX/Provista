import type { MealAllocationProjection, MealType, PlanDay, PlanMeal } from './types';

export type PlanningStatus = 'unplanned' | 'partial' | 'planned';

export interface MealContextStatus {
  meal: PlanMeal;
  rowIndex: number;
  planned: boolean;
}

export interface DayPlanStatus {
  status: PlanningStatus;
  plannedCount: number;
  contextCount: number;
  hasSeparateMeal: boolean;
  shortageCount: number;
}

export interface PlanningTarget {
  dayIndex: number;
  mealType: MealType;
  rowIndex: number;
  meal: PlanMeal;
}

export function mealContexts(day: PlanDay, mealType: MealType): MealContextStatus[] {
  return day.meals
    .filter(meal => meal.mealType === mealType)
    .map((meal, rowIndex) => ({ meal, rowIndex, planned: Boolean(meal.name.trim()) }));
}

export function allocationShortagesByDate(projection?: MealAllocationProjection) {
  const counts = new Map<string, number>();
  for (const allocation of projection?.mealAllocations || []) {
    const date = String(allocation.date || '').slice(0, 10);
    const shoppingQuantity = Number(allocation.shoppingQuantity) || 0;
    if (date && shoppingQuantity > 0) counts.set(date, (counts.get(date) || 0) + 1);
  }
  return counts;
}

export function dayPlanStatus(
  day: PlanDay,
  enabledMealTypes: MealType[],
  shortageCount = 0
): DayPlanStatus {
  const contexts = enabledMealTypes
    .filter(mealType => mealType !== 'special')
    .flatMap(mealType => mealContexts(day, mealType));
  const plannedCount = contexts.filter(context => context.planned).length;
  const status: PlanningStatus = plannedCount === 0
    ? 'unplanned'
    : plannedCount === contexts.length
      ? 'planned'
      : 'partial';

  return {
    status,
    plannedCount,
    contextCount: contexts.length,
    hasSeparateMeal: day.meals.some(meal => meal.mealType === 'special') || contexts.length > enabledMealTypes.filter(type => type !== 'special').length,
    shortageCount
  };
}

export function nextUnfinishedContext(day: PlanDay, mealType: MealType, afterRowIndex: number) {
  const contexts = mealContexts(day, mealType);
  return contexts.find(context => context.rowIndex > afterRowIndex && !context.planned)
    || contexts.find(context => !context.planned)
    || null;
}

export function nextPlanningTarget(
  days: PlanDay[],
  enabledMealTypes: MealType[],
  currentDayIndex: number,
  currentMealType: MealType
): PlanningTarget | null {
  const mealTypes = enabledMealTypes.filter(type => type !== 'special');
  const currentMealIndex = Math.max(0, mealTypes.indexOf(currentMealType));

  for (let dayOffset = 0; dayOffset < days.length; dayOffset += 1) {
    const dayIndex = (currentDayIndex + dayOffset) % days.length;
    const mealStart = dayOffset === 0 ? currentMealIndex + 1 : 0;
    for (let mealOffset = 0; mealOffset < mealTypes.length; mealOffset += 1) {
      const mealIndex = (mealStart + mealOffset) % mealTypes.length;
      if (dayOffset === 0 && mealIndex <= currentMealIndex) continue;
      const mealType = mealTypes[mealIndex];
      const unfinished = mealContexts(days[dayIndex], mealType).find(context => !context.planned);
      if (unfinished) return { dayIndex, mealType, rowIndex: unfinished.rowIndex, meal: unfinished.meal };
    }
  }

  return null;
}
