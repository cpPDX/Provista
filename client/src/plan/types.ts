export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'special';

export interface PlanPerson {
  _id: string;
  displayName: string;
  userId?: string | null;
  active?: boolean;
  historical?: boolean;
}

export interface PlanMeal {
  mealType: MealType;
  personName?: string;
  personIds: string[];
  forEveryone: boolean;
  name: string;
  notes: string;
}

export interface PlanDay {
  date: string;
  meals: PlanMeal[];
  specialCollapsed?: boolean;
}

export interface MealPlan {
  _id?: string;
  householdId?: string;
  weekStart: string;
  days: PlanDay[];
  people: PlanPerson[];
  produceNotes: string;
  shoppingNotes: string;
  _scaffold?: boolean;
}

export interface MealPlanSettings {
  weekStartDay: 0 | 1 | 6;
  mealPlanMode: 'dinner' | 'all';
}

export interface FavoriteMeal {
  _id: string;
  name: string;
  notes: string;
  useCount?: number;
  lastUsedAt?: string;
}

export interface ShoppingSuggestionItem {
  _id: string;
  name: string;
  brand?: string;
  onList?: boolean;
  pantryTrackingMode?: 'simple' | 'exact' | null;
  pantryStatus?: 'have' | 'low' | 'out' | null;
  pantryQuantity?: number;
  projectedQuantity?: number | null;
  lowStockThreshold?: number | null;
  shoppingNeeded?: boolean;
}

export interface MealShoppingSuggestion {
  sourceText: string;
  quantity: number;
  matchStatus: 'matched' | 'ambiguous' | 'unmatched';
  duplicateInNotes?: boolean;
  item?: ShoppingSuggestionItem;
  candidates?: ShoppingSuggestionItem[];
}

export interface MealShoppingPreview {
  parsedCount: number;
  suggestions: MealShoppingSuggestion[];
}

export interface MealAllocationSummary {
  itemId: string;
  name: string;
  unit: string;
  trackingMode: 'simple' | 'exact' | null;
  pantryStatus: 'have' | 'low' | 'out' | 'not-tracked';
  onHandQuantity: number | null;
  plannedQuantity: number;
  projectedQuantity: number | null;
  lowStockThreshold: number | null;
  belowLowStockThreshold: boolean | null;
  shortageQuantity: number | null;
  listQuantity: number;
  shoppingQuantity: number;
}

export interface MealAllocationProjection {
  weekStart: string | null;
  itemSummaries: MealAllocationSummary[];
  mealAllocations: Array<{
    date: string;
    dayIndex: number;
    mealIndex: number;
    mealType: MealType;
    mealName: string;
    itemId: string;
    name: string;
    quantity: number;
    shoppingQuantity: number;
    coverageStatus: string;
  }>;
  unresolvedNeeds: Array<Record<string, unknown>>;
}
