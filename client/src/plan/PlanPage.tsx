import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnlineStatus } from '../app/useOnlineStatus';
import { useAuth } from '../auth/AuthProvider';
import {
  completeFirstAction,
  goBackInOnboarding,
  loadOnboarding,
  onboardingQueryKey
} from '../onboarding/api';
import { useConfirm } from '../shell/DialogProvider';
import { useDirtyState } from '../shell/DirtyStateProvider';
import { useToast } from '../shell/ToastProvider';
import {
  addMealShoppingNeeds,
  copyPreviousWeek,
  deleteFavoriteMeal,
  favoriteMealsQueryKey,
  loadFavoriteMeals,
  loadMealPlan,
  loadMealPlanSettings,
  mealPlanQueryKey,
  mealPlanSettingsQueryKey,
  previewMealShoppingNeeds,
  saveFavoriteMeal,
  saveMealPlan,
  saveMealPlanSettings,
  updateFavoriteMeal,
  useFavoriteMeal
} from './api';
import type {
  FavoriteMeal,
  MealPlan,
  MealPlanSettings,
  MealShoppingPreview,
  MealType,
  PlanDay,
  PlanMeal,
  ShoppingSuggestionItem
} from './types';
import './plan.css';

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  special: 'Separate meal'
};

function isoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function normalizeWeekStart(date: Date, weekStartDay: number) {
  const copy = new Date(date);
  let offset = copy.getDay() - weekStartDay;
  if (offset < 0) offset += 7;
  copy.setDate(copy.getDate() - offset);
  return isoDate(copy);
}

function addWeeks(value: string, delta: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + delta * 7);
  return isoDate(date);
}

function weekLabel(value: string) {
  const start = localDate(value);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(localDate(value));
}

function clonePlan(plan: MealPlan): MealPlan {
  return JSON.parse(JSON.stringify(plan)) as MealPlan;
}

function normalizePlan(plan: MealPlan): MealPlan {
  return {
    ...plan,
    weekStart: String(plan.weekStart).slice(0, 10),
    produceNotes: plan.produceNotes || '',
    shoppingNotes: plan.shoppingNotes || '',
    people: Array.isArray(plan.people) ? plan.people : [],
    days: (plan.days || []).map(day => ({
      ...day,
      date: String(day.date).slice(0, 10),
      meals: (day.meals || []).map(meal => ({
        mealType: meal.mealType,
        personName: meal.personName || '',
        personIds: Array.isArray(meal.personIds) ? meal.personIds.map(String) : [],
        forEveryone: meal.forEveryone !== false,
        name: meal.name || '',
        notes: meal.notes || ''
      }))
    }))
  };
}

function emptyMeal(mealType: MealType): PlanMeal {
  return { mealType, personName: '', personIds: [], forEveryone: true, name: '', notes: '' };
}

function mealKey(dayIndex: number, mealType: MealType, rowIndex: number) {
  return `${dayIndex}|${mealType}|${rowIndex}`;
}

function parseMealKey(key: string) {
  const [dayIndex, mealType, rowIndex] = key.split('|');
  return { dayIndex: Number(dayIndex), mealType: mealType as MealType, rowIndex: Number(rowIndex) };
}

function mealRows(day: PlanDay, mealType: MealType) {
  const rows = day.meals.filter(meal => meal.mealType === mealType);
  return rows.length ? rows : [emptyMeal(mealType)];
}

function hasPlannedMeal(plan: MealPlan | null) {
  return Boolean(plan?.days.some(day => day.meals.some(meal => meal.name.trim())));
}

function pantryContext(item: ShoppingSuggestionItem) {
  if (item.onList) return 'Already on List';
  if (item.pantryTrackingMode === 'simple') {
    const label = { have: 'Have', low: 'Running low', out: 'Out' }[item.pantryStatus || 'have'];
    return `Pantry: ${label}`;
  }
  if (item.pantryTrackingMode === 'exact') {
    return `Pantry ${item.pantryQuantity || 0} → ${item.projectedQuantity ?? 0} after meal`;
  }
  return 'Not in Pantry';
}

export function PlanPage() {
  const { isAdmin } = useAuth();
  const online = useOnlineStatus();
  const confirm = useConfirm();
  const { setDirty } = useDirtyState();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const settingsQuery = useQuery({ queryKey: mealPlanSettingsQueryKey, queryFn: loadMealPlanSettings });
  const onboardingQuery = useQuery({ queryKey: onboardingQueryKey, queryFn: loadOnboarding });
  const favoritesQuery = useQuery({ queryKey: favoriteMealsQueryKey, queryFn: loadFavoriteMeals });
  const [weekStart, setWeekStart] = useState('');
  const [draft, setDraft] = useState<MealPlan | null>(null);
  const [dirty, setLocalDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [revealedSpecialDays, setRevealedSpecialDays] = useState<Set<number>>(new Set());
  const [favoriteTarget, setFavoriteTarget] = useState<string | null>(null);
  const [favoriteEditing, setFavoriteEditing] = useState<FavoriteMeal | null>(null);
  const [favoriteEditName, setFavoriteEditName] = useState('');
  const [favoriteEditNotes, setFavoriteEditNotes] = useState('');
  const [shoppingTarget, setShoppingTarget] = useState<string | null>(null);
  const [shoppingPreview, setShoppingPreview] = useState<MealShoppingPreview | null>(null);
  const [shoppingSelections, setShoppingSelections] = useState<Record<number, { itemId: string; quantity: number } | null>>({});
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<MealPlanSettings | null>(null);
  const revisionRef = useRef(0);
  const lastSavedRef = useRef<MealPlan | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const queuedSaveRef = useRef<{ snapshot: MealPlan; revision: number } | null>(null);
  const saveRunRef = useRef<Promise<boolean> | null>(null);
  const firstFocusDoneRef = useRef(false);

  useEffect(() => {
    if (!settingsQuery.data || weekStart) return;
    setWeekStart(normalizeWeekStart(new Date(), settingsQuery.data.weekStartDay));
    setSettingsDraft(settingsQuery.data);
  }, [settingsQuery.data, weekStart]);

  const planQuery = useQuery({
    queryKey: mealPlanQueryKey(weekStart),
    queryFn: () => loadMealPlan(weekStart),
    enabled: Boolean(weekStart)
  });

  useEffect(() => {
    if (!planQuery.data || draft) return;
    const next = normalizePlan(planQuery.data);
    setDraft(next);
    lastSavedRef.current = clonePlan(next);
    revisionRef.current = 0;
    setLocalDirty(false);
    setDirty('react-plan', false);
    setSaveStatus('saved');
    setRevealedSpecialDays(new Set());

    const today = isoDate();
    const todayIndex = next.days.findIndex(day => day.date.slice(0, 10) === today);
    const initial = new Set<number>();
    next.days.forEach((day, index) => {
      const hasMeal = day.meals.some(meal => meal.name.trim());
      if (hasMeal || (todayIndex >= 0 && index >= todayIndex && index <= todayIndex + 2)) initial.add(index);
    });
    if (todayIndex >= 0) initial.add(todayIndex);
    setExpandedDays(initial);
  }, [draft, planQuery.data, setDirty]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setDirty('react-plan', false);
  }, [setDirty]);

  const onboardingActive = Boolean(
    onboardingQuery.data?.required &&
    onboardingQuery.data.firstAction === 'plan' &&
    onboardingQuery.data.step === 'first_action'
  );

  const completeOnboardingIfReady = async (snapshot: MealPlan) => {
    if (!onboardingActive || !hasPlannedMeal(snapshot)) return;
    try {
      const next = await completeFirstAction();
      queryClient.setQueryData(onboardingQueryKey, next);
      showToast('Tonight has a plan. Home is ready.', { tone: 'success', durationMs: 4500 });
      navigate('/app', { replace: true });
    } catch (error) {
      console.info('Onboarding completion is not ready yet:', error);
    }
  };

  const runSaveQueue = async (): Promise<boolean> => {
    while (queuedSaveRef.current) {
      const queued = queuedSaveRef.current;
      queuedSaveRef.current = null;

      try {
        const saved = await saveMealPlan({
          weekStart: queued.snapshot.weekStart,
          days: queued.snapshot.days,
          produceNotes: queued.snapshot.produceNotes,
          shoppingNotes: queued.snapshot.shoppingNotes
        });
        const normalized = normalizePlan({ ...saved, people: queued.snapshot.people });
        lastSavedRef.current = clonePlan(normalized);
        await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });

        if (!queuedSaveRef.current && revisionRef.current === queued.revision) {
          setDraft(normalized);
          setLocalDirty(false);
          setDirty('react-plan', false);
          setSaveStatus('saved');
          await completeOnboardingIfReady(normalized);
        }
      } catch (error) {
        queuedSaveRef.current = null;
        console.error(error);
        setSaveStatus('error');
        showToast('Could not save the meal plan.', { tone: 'error' });
        return false;
      }
    }

    return true;
  };

  const queueDraftSave = (snapshot: MealPlan, revision: number): Promise<boolean> => {
    if (!online) return Promise.resolve(false);
    queuedSaveRef.current = { snapshot, revision };
    setSaveStatus('saving');

    if (!saveRunRef.current) {
      saveRunRef.current = runSaveQueue().finally(() => {
        saveRunRef.current = null;
      });
    }

    return saveRunRef.current;
  };

  useEffect(() => {
    if (!dirty || !draft || !online) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const snapshot = clonePlan(draft);
    const revision = revisionRef.current;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void queueDraftSave(snapshot, revision);
    }, 650);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [dirty, draft, online]);

  const mutateDraft = (updater: (plan: MealPlan) => void) => {
    setDraft(current => {
      if (!current) return current;
      const next = clonePlan(current);
      updater(next);
      revisionRef.current += 1;
      const fallback = lastSavedRef.current ? clonePlan(lastSavedRef.current) : clonePlan(current);
      setLocalDirty(true);
      setDirty('react-plan', true, () => {
        setDraft(fallback);
        revisionRef.current += 1;
        setLocalDirty(false);
        setSaveStatus('saved');
      });
      setSaveStatus('idle');
      return next;
    });
  };

  const saveCurrentDraftIfNeeded = async () => {
    if (!draft) return true;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    if (dirty) return queueDraftSave(clonePlan(draft), revisionRef.current);
    return saveRunRef.current || true;
  };

  const findMeal = (plan: MealPlan, dayIndex: number, mealType: MealType, rowIndex: number) => {
    const rows = plan.days[dayIndex].meals.filter(meal => meal.mealType === mealType);
    return rows[rowIndex];
  };

  const updateMeal = (dayIndex: number, mealType: MealType, rowIndex: number, patch: Partial<PlanMeal>) => {
    mutateDraft(plan => {
      const day = plan.days[dayIndex];
      const indexes = day.meals.map((meal, index) => ({ meal, index })).filter(entry => entry.meal.mealType === mealType);
      if (!indexes.length) {
        day.meals.push({ ...emptyMeal(mealType), ...patch });
        return;
      }
      const actualIndex = indexes[rowIndex]?.index;
      if (actualIndex == null) return;
      day.meals[actualIndex] = { ...day.meals[actualIndex], ...patch };
    });
  };

  const addSeparateMeal = (dayIndex: number, mealType: MealType) => {
    mutateDraft(plan => plan.days[dayIndex].meals.push(emptyMeal(mealType)));
    setExpandedDays(current => new Set(current).add(dayIndex));
  };

  const revealSpecialMeal = (dayIndex: number) => {
    const hasSpecialRow = Boolean(draft?.days[dayIndex]?.meals.some(meal => meal.mealType === 'special'));
    if (!hasSpecialRow) mutateDraft(plan => plan.days[dayIndex].meals.push(emptyMeal('special')));
    setRevealedSpecialDays(current => new Set(current).add(dayIndex));
    setExpandedDays(current => new Set(current).add(dayIndex));
  };

  const removeSeparateMeal = async (dayIndex: number, mealType: MealType, rowIndex: number) => {
    if (!draft) return;
    const meal = findMeal(draft, dayIndex, mealType, rowIndex);
    if (!meal) return;
    if (meal.name || meal.notes) {
      const confirmed = await confirm({
        title: 'Remove this separate meal?',
        message: 'The meal name and shopping needs in this row will be removed from the plan.',
        confirmLabel: 'Remove meal',
        cancelLabel: 'Keep meal',
        danger: true
      });
      if (!confirmed) return;
    }
    mutateDraft(plan => {
      const day = plan.days[dayIndex];
      const indexes = day.meals.map((entry, index) => ({ entry, index })).filter(entry => entry.entry.mealType === mealType);
      const actualIndex = indexes[rowIndex]?.index;
      if (actualIndex != null) day.meals.splice(actualIndex, 1);
    });
  };

  const repeatMeal = (dayIndex: number, mealType: MealType, rowIndex: number) => {
    if (!draft) return;
    const source = findMeal(draft, dayIndex, mealType, rowIndex);
    if (!source?.name.trim()) return;
    let destination: { dayIndex: number; rowIndex: number } | null = null;
    for (let index = dayIndex + 1; index < draft.days.length && !destination; index++) {
      const rows = mealRows(draft.days[index], mealType);
      const openIndex = rows.findIndex(meal => !meal.name.trim() && !meal.notes.trim());
      if (openIndex >= 0) destination = { dayIndex: index, rowIndex: openIndex };
    }
    if (!destination) {
      showToast('No open day remains this week for that meal');
      return;
    }
    updateMeal(destination.dayIndex, mealType, destination.rowIndex, {
      name: source.name,
      notes: source.notes,
      forEveryone: source.forEveryone,
      personIds: [...source.personIds],
      personName: source.personName || ''
    });
    setExpandedDays(current => new Set(current).add(destination!.dayIndex));
    showToast(`${source.name} repeated on ${dayLabel(draft.days[destination.dayIndex].date)}`);
  };

  const planLeftovers = (dayIndex: number, mealType: MealType, rowIndex: number) => {
    const meal = draft ? findMeal(draft, dayIndex, mealType, rowIndex) : null;
    if (!meal || meal.name || meal.notes) return;
    updateMeal(dayIndex, mealType, rowIndex, { name: 'Leftovers' });
    showToast('Leftovers planned');
  };

  const audienceLabel = (meal: PlanMeal) => {
    if (meal.forEveryone !== false) return 'Everyone';
    const labels = meal.personIds.map(id => draft?.people.find(person => String(person._id) === String(id))?.displayName).filter(Boolean);
    return labels.length ? labels.join(', ') : meal.personName || 'Choose people';
  };

  const togglePerson = (dayIndex: number, mealType: MealType, rowIndex: number, personId: string, checked: boolean) => {
    const meal = draft ? findMeal(draft, dayIndex, mealType, rowIndex) : null;
    const next = new Set(meal?.personIds || []);
    if (checked) next.add(personId); else next.delete(personId);
    updateMeal(dayIndex, mealType, rowIndex, { forEveryone: false, personIds: [...next], personName: '' });
  };

  const goToWeek = async (targetWeekStart: string) => {
    if (!weekStart || !draft || targetWeekStart === weekStart) return;
    if (!(await saveCurrentDraftIfNeeded())) return;
    setDraft(null);
    setWeekStart(targetWeekStart);
    setExpandedDays(new Set());
    setRevealedSpecialDays(new Set());
    firstFocusDoneRef.current = false;
  };

  const navigateWeek = async (delta: number) => {
    if (!weekStart) return;
    await goToWeek(addWeeks(weekStart, delta));
  };

  const copyLastWeek = async () => {
    if (!weekStart) return;
    const confirmed = await confirm({
      title: 'Replace this week with last week?',
      message: 'Meals and weekly notes from last week will replace the entries currently shown for this week.',
      confirmLabel: 'Copy last week',
      cancelLabel: 'Cancel'
    });
    if (!confirmed) return;
    if (!(await saveCurrentDraftIfNeeded())) return;
    try {
      const copied = normalizePlan({ ...(await copyPreviousWeek(weekStart)), people: draft?.people || [] });
      setDraft(copied);
      lastSavedRef.current = clonePlan(copied);
      revisionRef.current += 1;
      setLocalDirty(false);
      setDirty('react-plan', false);
      setSaveStatus('saved');
      showToast('Last week copied', { tone: 'success' });
      await completeOnboardingIfReady(copied);
    } catch (error) {
      console.error(error);
      showToast('No meal plan found for last week.', { tone: 'error' });
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft || !isAdmin) return;
    const nextWeekStart = normalizeWeekStart(new Date(), settingsDraft.weekStartDay);
    if (nextWeekStart !== weekStart && !(await saveCurrentDraftIfNeeded())) return;
    try {
      const saved = await saveMealPlanSettings(settingsDraft);
      queryClient.setQueryData(mealPlanSettingsQueryKey, saved);
      setSettingsDraft(saved);
      setSettingsOpen(false);
      showToast('Plan settings updated', { tone: 'success' });
      if (nextWeekStart !== weekStart) {
        setDraft(null);
        setWeekStart(nextWeekStart);
        setExpandedDays(new Set());
        setRevealedSpecialDays(new Set());
        firstFocusDoneRef.current = false;
      }
    } catch (error) {
      console.error(error);
      showToast('Could not update Plan settings.', { tone: 'error' });
    }
  };

  const changeFirstAction = async () => {
    if (!(await saveCurrentDraftIfNeeded())) return;
    try {
      const next = await goBackInOnboarding();
      queryClient.setQueryData(onboardingQueryKey, next);
      navigate('/app', { replace: true });
    } catch (error) {
      console.error(error);
      showToast('Could not change the first action.', { tone: 'error' });
    }
  };

  const saveAsFavorite = async (meal: PlanMeal) => {
    if (!meal.name.trim()) return;
    try {
      await saveFavoriteMeal({ name: meal.name, notes: meal.notes });
      await queryClient.invalidateQueries({ queryKey: favoriteMealsQueryKey });
      showToast(`${meal.name} saved to Favorite meals`, { tone: 'success' });
    } catch (error) {
      console.error(error);
      showToast('Could not save that favorite meal.', { tone: 'error' });
    }
  };

  const applyFavorite = async (favorite: FavoriteMeal) => {
    if (!favoriteTarget || !draft) return;
    const target = parseMealKey(favoriteTarget);
    const current = findMeal(draft, target.dayIndex, target.mealType, target.rowIndex);
    if (current && (current.name || current.notes)) {
      const confirmed = await confirm({
        title: `Replace ${current.name || 'this meal'}?`,
        message: `This replaces the current meal and its shopping needs with ${favorite.name}.`,
        confirmLabel: 'Replace meal',
        cancelLabel: 'Keep current meal'
      });
      if (!confirmed) return;
    }
    try {
      const used = await useFavoriteMeal(favorite._id);
      updateMeal(target.dayIndex, target.mealType, target.rowIndex, { name: used.name, notes: used.notes || '' });
      setFavoriteTarget(null);
      await queryClient.invalidateQueries({ queryKey: favoriteMealsQueryKey });
      showToast(`${used.name} planned`, { tone: 'success' });
    } catch (error) {
      console.error(error);
      showToast('Could not use that favorite meal.', { tone: 'error' });
    }
  };

  const beginFavoriteEdit = (favorite: FavoriteMeal) => {
    setFavoriteEditing(favorite);
    setFavoriteEditName(favorite.name);
    setFavoriteEditNotes(favorite.notes || '');
  };

  const saveFavoriteEdit = async () => {
    if (!favoriteEditing || !favoriteEditName.trim()) return;
    try {
      await updateFavoriteMeal(favoriteEditing._id, { name: favoriteEditName.trim(), notes: favoriteEditNotes.trim() });
      setFavoriteEditing(null);
      await queryClient.invalidateQueries({ queryKey: favoriteMealsQueryKey });
      showToast('Favorite meal updated', { tone: 'success' });
    } catch (error) {
      console.error(error);
      showToast('Could not update that favorite.', { tone: 'error' });
    }
  };

  const removeFavorite = async (favorite: FavoriteMeal) => {
    const confirmed = await confirm({
      title: `Delete ${favorite.name} from Favorite meals?`,
      message: 'Meals already planned this week will not change.',
      confirmLabel: 'Delete favorite',
      cancelLabel: 'Keep favorite',
      danger: true
    });
    if (!confirmed) return;
    await deleteFavoriteMeal(favorite._id);
    await queryClient.invalidateQueries({ queryKey: favoriteMealsQueryKey });
    showToast('Favorite meal deleted');
  };

  const openShoppingReview = async (key: string, notes: string) => {
    if (!notes.trim()) return;
    setShoppingTarget(key);
    setShoppingPreview(null);
    setShoppingSelections({});
    setShoppingLoading(true);
    try {
      const preview = await previewMealShoppingNeeds(notes);
      const selections: Record<number, { itemId: string; quantity: number } | null> = {};
      preview.suggestions.forEach((suggestion, index) => {
        if (suggestion.matchStatus === 'matched' && suggestion.item && !suggestion.item.onList && !suggestion.duplicateInNotes && suggestion.item.shoppingNeeded) {
          selections[index] = { itemId: suggestion.item._id, quantity: Number(suggestion.quantity) || 1 };
        }
      });
      setShoppingPreview(preview);
      setShoppingSelections(selections);
    } catch (error) {
      console.error(error);
      setShoppingTarget(null);
      showToast('Could not check Pantry and List for this meal.', { tone: 'error' });
    } finally {
      setShoppingLoading(false);
    }
  };

  const setMatchedSelection = (index: number, item: ShoppingSuggestionItem | null, quantity: number) => {
    setShoppingSelections(current => ({
      ...current,
      [index]: item && !item.onList ? { itemId: item._id, quantity: Number(quantity) || 1 } : null
    }));
  };

  const addSelectedShoppingNeeds = async () => {
    const items = Object.values(shoppingSelections).filter((value): value is { itemId: string; quantity: number } => Boolean(value));
    if (!items.length) return;
    try {
      const result = await addMealShoppingNeeds(items);
      setShoppingTarget(null);
      setShoppingPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['shopping-list'], refetchType: 'none' });
      await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });
      const skipped = result.skippedCount ? ` · ${result.skippedCount} already on List` : '';
      showToast(`Added ${result.addedCount} item${result.addedCount === 1 ? '' : 's'} to Shopping List${skipped}`, { tone: 'success' });
    } catch (error) {
      console.error(error);
      showToast('Could not add those shopping needs.', { tone: 'error' });
    }
  };

  const visibleMealTypes = useMemo<MealType[]>(() => {
    if (settingsQuery.data?.mealPlanMode === 'all') return ['breakfast', 'lunch', 'dinner', 'special'];
    return ['dinner', 'special'];
  }, [settingsQuery.data?.mealPlanMode]);

  useEffect(() => {
    if (!draft || firstFocusDoneRef.current) return;
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus !== 'today-dinner' && !onboardingActive) return;
    const todayIndex = draft.days.findIndex(day => day.date === isoDate());
    if (todayIndex < 0) return;
    setExpandedDays(current => new Set(current).add(todayIndex));
    firstFocusDoneRef.current = true;
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>(`[data-plan-day="${todayIndex}"] input[data-meal-name="dinner-0"]`)?.focus({ preventScroll: true });
    }, 0);
  }, [draft, location.search, onboardingActive]);

  if (settingsQuery.isPending || !weekStart || planQuery.isPending || !draft) {
    return <div className="plan-state" aria-busy="true">Loading your plan…</div>;
  }

  if (settingsQuery.isError || planQuery.isError) {
    return (
      <div className="plan-state">
        <strong>Couldn’t load the meal plan</strong>
        <span>Try again when your connection is available.</span>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => { void settingsQuery.refetch(); void planQuery.refetch(); }}>Try again</button>
      </div>
    );
  }

  const today = isoDate();
  const thisWeekStart = normalizeWeekStart(new Date(), settingsQuery.data!.weekStartDay);

  return (
    <section className="plan-page" aria-labelledby="plan-title">
      <header className="plan-heading">
        <div>
          <p className="plan-eyebrow">Household meals</p>
          <h1 id="plan-title">Plan</h1>
          <p>Plan what matters this week. Provista saves changes automatically.</p>
        </div>
        <div className={`plan-save-status plan-save-${saveStatus}`} role="status">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Couldn’t save' : dirty ? 'Unsaved changes' : 'Saved ✓'}
        </div>
      </header>

      {onboardingActive && (
        <aside className="plan-onboarding-banner">
          <strong>First useful action: plan tonight</strong>
          <span>Put one real meal on today. Once it saves, Provista will take you to Home with the result visible.</span>
          <button type="button" className="plan-link-button" disabled={!online || saveStatus === 'saving'} onClick={() => void changeFirstAction()}>Choose List instead</button>
        </aside>
      )}

      {!online && <div className="plan-offline" role="status">Offline — Plan is read-only until you reconnect.</div>}

      <div className="plan-week-bar">
        <button type="button" className="shell-button shell-button-secondary" onClick={() => void navigateWeek(-1)}>← Previous</button>
        <div>
          <strong>{weekLabel(weekStart)}</strong>
          <button type="button" className="plan-link-button" disabled={thisWeekStart === weekStart} onClick={() => void goToWeek(thisWeekStart)}>This week</button>
        </div>
        <button type="button" className="shell-button shell-button-secondary" onClick={() => void navigateWeek(1)}>Next →</button>
      </div>

      <div className="plan-tools">
        <button type="button" className="shell-button shell-button-secondary" disabled={!online} onClick={() => void copyLastWeek()}>Copy last week</button>
        <details>
          <summary>Favorite meals</summary>
          <div className="plan-favorite-manager">
            {favoritesQuery.data?.length ? favoritesQuery.data.map(favorite => (
              <div className="plan-favorite-card" key={favorite._id}>
                {favoriteEditing?._id === favorite._id ? (
                  <div className="plan-favorite-edit-form">
                    <input aria-label="Favorite meal name" value={favoriteEditName} onChange={event => setFavoriteEditName(event.target.value)} />
                    <textarea aria-label="Favorite shopping needs" value={favoriteEditNotes} onChange={event => setFavoriteEditNotes(event.target.value)} />
                    <div>
                      <button type="button" className="shell-button shell-button-primary" onClick={() => void saveFavoriteEdit()}>Save changes</button>
                      <button type="button" className="shell-button shell-button-secondary" onClick={() => setFavoriteEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div><strong>{favorite.name}</strong><small>{favorite.notes || 'No saved shopping needs'}</small></div>
                    <div>
                      <button type="button" className="plan-link-button" onClick={() => beginFavoriteEdit(favorite)}>Edit</button>
                      <button type="button" className="plan-link-button" onClick={() => void removeFavorite(favorite)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            )) : <p className="plan-muted">No favorite meals yet. Save one from a planned meal below.</p>}
          </div>
        </details>
        {isAdmin && (
          <details open={settingsOpen} onToggle={event => setSettingsOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary>Plan settings</summary>
            {settingsDraft && (
              <div className="plan-settings">
                <label>Meals shown
                  <select value={settingsDraft.mealPlanMode} onChange={event => setSettingsDraft({ ...settingsDraft, mealPlanMode: event.target.value as MealPlanSettings['mealPlanMode'] })}>
                    <option value="dinner">Dinner + separate meals</option>
                    <option value="all">Breakfast, lunch, dinner + separate meals</option>
                  </select>
                </label>
                <label>Week starts
                  <select value={settingsDraft.weekStartDay} onChange={event => setSettingsDraft({ ...settingsDraft, weekStartDay: Number(event.target.value) as MealPlanSettings['weekStartDay'] })}>
                    <option value={6}>Saturday</option>
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                  </select>
                </label>
                <button type="button" className="shell-button shell-button-primary" disabled={!online || saveStatus === 'saving'} onClick={() => void saveSettings()}>Save settings</button>
              </div>
            )}
          </details>
        )}
      </div>

      <div className="plan-days">
        {draft.days.map((day, dayIndex) => {
          const expanded = expandedDays.has(dayIndex);
          const names = day.meals.map(meal => meal.name.trim()).filter(Boolean);
          const isToday = day.date === today;
          return (
            <article className={`plan-day ${isToday ? 'plan-day-today' : ''}`} data-plan-day={dayIndex} key={day.date}>
              <button
                type="button"
                className="plan-day-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedDays(current => {
                  const next = new Set(current);
                  if (next.has(dayIndex)) next.delete(dayIndex); else next.add(dayIndex);
                  return next;
                })}
              >
                <span><strong>{dayLabel(day.date)}</strong>{isToday && <em>Today</em>}</span>
                <span className="plan-day-summary">{names.length ? names.slice(0, 2).join(' · ') : 'Not planned'}</span>
                <span aria-hidden="true">{expanded ? '−' : '+'}</span>
              </button>

              {expanded && (
                <div className="plan-day-content">
                  {visibleMealTypes.map(mealType => {
                    const rows = mealRows(day, mealType);
                    const isSpecial = mealType === 'special';
                    const showSpecial = !isSpecial || rows.some(meal => meal.name || meal.notes) || onboardingActive || revealedSpecialDays.has(dayIndex);
                    if (!showSpecial && settingsQuery.data?.mealPlanMode === 'dinner') {
                      return (
                        <button key={mealType} type="button" className="plan-add-special" disabled={!online} onClick={() => revealSpecialMeal(dayIndex)}>
                          + Add a separate meal
                        </button>
                      );
                    }
                    return (
                      <section className="plan-meal-section" data-meal-type={mealType} key={mealType}>
                        <div className="plan-meal-section-heading">
                          <h2>{MEAL_LABELS[mealType]}</h2>
                          {mealType !== 'special' && <button type="button" className="plan-link-button" disabled={!online} onClick={() => addSeparateMeal(dayIndex, mealType)}>+ Separate meal</button>}
                        </div>

                        {rows.map((meal, rowIndex) => {
                          const key = mealKey(dayIndex, mealType, rowIndex);
                          const hasContent = Boolean(meal.name || meal.notes);
                          return (
                            <div className="plan-meal-row" key={key}>
                              <div className="plan-meal-topline">
                                <label>
                                  <span>Meal</span>
                                  <input
                                    data-meal-name={`${mealType}-${rowIndex}`}
                                    value={meal.name}
                                    disabled={!online}
                                    placeholder={mealType === 'special' ? 'Separate meal…' : 'Meal…'}
                                    onChange={event => updateMeal(dayIndex, mealType, rowIndex, { name: event.target.value })}
                                  />
                                </label>
                                <details className="plan-audience">
                                  <summary>{audienceLabel(meal)} · Change</summary>
                                  <div>
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={meal.forEveryone !== false}
                                        disabled={!online}
                                        onChange={event => updateMeal(dayIndex, mealType, rowIndex, {
                                          forEveryone: event.target.checked,
                                          personIds: event.target.checked ? [] : meal.personIds,
                                          personName: event.target.checked ? '' : meal.personName || ''
                                        })}
                                      /> Everyone
                                    </label>
                                    {draft.people.map(person => (
                                      <label key={person._id}>
                                        <input
                                          type="checkbox"
                                          checked={!meal.forEveryone && meal.personIds.includes(String(person._id))}
                                          disabled={!online || meal.forEveryone}
                                          onChange={event => togglePerson(dayIndex, mealType, rowIndex, String(person._id), event.target.checked)}
                                        /> {person.displayName}{person.historical ? ' (past)' : ''}
                                      </label>
                                    ))}
                                  </div>
                                </details>
                              </div>

                              <label className="plan-needs-field">
                                <span>Need for this meal</span>
                                <textarea
                                  value={meal.notes}
                                  disabled={!online}
                                  maxLength={2000}
                                  rows={2}
                                  placeholder="e.g. tortillas, lettuce, salsa"
                                  onChange={event => updateMeal(dayIndex, mealType, rowIndex, { notes: event.target.value })}
                                />
                              </label>

                              <div className="plan-meal-actions">
                                {meal.notes.trim() && <button type="button" className="plan-link-button" disabled={!online || shoppingLoading} onClick={() => void openShoppingReview(key, meal.notes)}>Check shopping needs</button>}
                                {meal.name.trim() && <button type="button" className="plan-link-button" disabled={!online} onClick={() => repeatMeal(dayIndex, mealType, rowIndex)}>Repeat later this week</button>}
                                {!hasContent && <button type="button" className="plan-link-button" disabled={!online} onClick={() => planLeftovers(dayIndex, mealType, rowIndex)}>Plan leftovers</button>}
                                {meal.name.trim() && <button type="button" className="plan-link-button" disabled={!online} onClick={() => void saveAsFavorite(meal)}>Save as favorite</button>}
                                <button type="button" className="plan-link-button" disabled={!online} onClick={() => setFavoriteTarget(key)}>Use favorite</button>
                                {(isSpecial || rows.length > 1) && <button type="button" className="plan-link-button plan-danger-link" disabled={!online} onClick={() => void removeSeparateMeal(dayIndex, mealType, rowIndex)}>Remove meal</button>}
                              </div>
                            </div>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <section className="plan-produce">
        <label htmlFor="plan-produce-notes">Produce to use this week</label>
        <textarea
          id="plan-produce-notes"
          value={draft.produceNotes}
          disabled={!online}
          rows={3}
          placeholder="Anything you want to remember to use before it goes bad…"
          onChange={event => mutateDraft(plan => { plan.produceNotes = event.target.value; })}
        />
      </section>

      {favoriteTarget && (
        <div className="plan-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFavoriteTarget(null); }}>
          <section className="plan-dialog" role="dialog" aria-modal="true" aria-labelledby="favorite-picker-title">
            <div className="plan-dialog-heading"><h2 id="favorite-picker-title">Use favorite meal</h2><button type="button" aria-label="Close favorite meals" onClick={() => setFavoriteTarget(null)}>✕</button></div>
            <p>Choose a saved meal. Its usual shopping needs come with it.</p>
            <div className="plan-dialog-list">
              {favoritesQuery.data?.length ? favoritesQuery.data.map(favorite => (
                <button type="button" className="plan-dialog-choice" key={favorite._id} onClick={() => void applyFavorite(favorite)}>
                  <strong>{favorite.name}</strong><small>{favorite.notes || 'No saved shopping needs'}</small>
                </button>
              )) : <p>No favorite meals yet.</p>}
            </div>
          </section>
        </div>
      )}

      {shoppingTarget && (
        <div className="plan-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShoppingTarget(null); }}>
          <section className="plan-dialog plan-shopping-dialog" role="dialog" aria-modal="true" aria-labelledby="shopping-review-title">
            <div className="plan-dialog-heading"><h2 id="shopping-review-title">Check meal shopping needs</h2><button type="button" aria-label="Close shopping needs" onClick={() => setShoppingTarget(null)}>✕</button></div>
            <p>Provista compares meal quantities with Pantry and the current List. Planning does not deduct Pantry.</p>
            {shoppingLoading && <p aria-busy="true">Checking Pantry & List…</p>}
            {shoppingPreview && (
              <div className="plan-shopping-suggestions">
                {shoppingPreview.suggestions.map((suggestion, index) => {
                  const quantity = Number(suggestion.quantity) || 1;
                  if (suggestion.matchStatus === 'unmatched') {
                    return (
                      <div className="plan-shopping-suggestion" key={`${suggestion.sourceText}-${index}`}>
                        <div><strong>{suggestion.sourceText}</strong><small>No catalog match.</small></div>
                        <button type="button" className="plan-link-button" onClick={() => { setShoppingTarget(null); navigate('/app/list'); }}>Add with details in List</button>
                      </div>
                    );
                  }
                  if (suggestion.matchStatus === 'ambiguous') {
                    return (
                      <div className="plan-shopping-suggestion" key={`${suggestion.sourceText}-${index}`}>
                        <label><strong>{suggestion.sourceText}</strong>
                          <select aria-label={`Choose catalog item for ${suggestion.sourceText}`} defaultValue="" onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                            const item = suggestion.candidates?.find(candidate => candidate._id === event.target.value) || null;
                            setMatchedSelection(index, item, quantity);
                          }}>
                            <option value="">Choose the household item…</option>
                            {suggestion.candidates?.map(candidate => <option value={candidate._id} key={candidate._id}>{candidate.name} — {pantryContext(candidate)}</option>)}
                          </select>
                        </label>
                      </div>
                    );
                  }
                  const item = suggestion.item!;
                  const selected = Boolean(shoppingSelections[index]);
                  return (
                    <label className="plan-shopping-suggestion plan-shopping-check" key={`${suggestion.sourceText}-${index}`}>
                      <input
                        type="checkbox"
                        disabled={item.onList || suggestion.duplicateInNotes}
                        checked={selected}
                        onChange={event => setMatchedSelection(index, event.target.checked ? item : null, quantity)}
                      />
                      <span><strong>{item.name}</strong><small>{pantryContext(item)}{quantity !== 1 ? ` · meal qty ${quantity}` : ''}</small></span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="plan-dialog-actions">
              <button type="button" className="shell-button shell-button-secondary" onClick={() => setShoppingTarget(null)}>Done</button>
              <button type="button" className="shell-button shell-button-primary" disabled={!Object.values(shoppingSelections).some(Boolean)} onClick={() => void addSelectedShoppingNeeds()}>Add selected to List</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
