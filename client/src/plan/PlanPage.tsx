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
  loadMealAllocations,
  loadFavoriteMeals,
  loadMealPlan,
  loadMealPlanSettings,
  mealPlanQueryKey,
  mealAllocationQueryKey,
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
import { allocationShortagesByDate, dayPlanStatus, mealContexts, nextPlanningTarget, nextUnfinishedContext } from './viewModel';
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

function safeDisplayUnit(value?: string | null) {
  const unit = String(value || '').trim();
  return unit && !/^\d+(?:\.\d+)?$/.test(unit) ? ` ${unit}` : '';
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
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [activeMealType, setActiveMealType] = useState<MealType>('dinner');
  const [activeRowIndex, setActiveRowIndex] = useState(0);
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
  const allocationQuery = useQuery({
    queryKey: mealAllocationQueryKey(weekStart),
    queryFn: () => loadMealAllocations(weekStart),
    enabled: Boolean(weekStart)
  });

  useEffect(() => {
    if (!planQuery.data || draft || String(planQuery.data.weekStart).slice(0, 10) !== weekStart) return;
    const next = normalizePlan(planQuery.data);
    setDraft(next);
    lastSavedRef.current = clonePlan(next);
    revisionRef.current = 0;
    setLocalDirty(false);
    setDirty('react-plan', false);
    setSaveStatus('saved');
    const today = isoDate();
    const todayIndex = next.days.findIndex(day => day.date.slice(0, 10) === today);
    try {
      const saved = JSON.parse(sessionStorage.getItem('provista-plan-context') || '{}');
      const savedDayIndex = saved.weekStart === weekStart
        ? next.days.findIndex(day => day.date === saved.date)
        : -1;
      setSelectedDayIndex(savedDayIndex >= 0 ? savedDayIndex : todayIndex >= 0 ? todayIndex : 0);
      setActiveMealType(['breakfast', 'lunch', 'dinner', 'special'].includes(saved.mealType) ? saved.mealType : 'dinner');
      setActiveRowIndex(Number.isInteger(saved.rowIndex) && saved.rowIndex >= 0 ? saved.rowIndex : 0);
    } catch {
      setSelectedDayIndex(todayIndex >= 0 ? todayIndex : 0);
      setActiveMealType('dinner');
      setActiveRowIndex(0);
    }
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
        queryClient.setQueryData(mealPlanQueryKey(normalized.weekStart), normalized);
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
    const nextRowIndex = draft ? mealContexts(draft.days[dayIndex], mealType).length : 0;
    const assigned = new Set(mealContexts(draft!.days[dayIndex], mealType).flatMap(context => context.meal.forEveryone === false ? context.meal.personIds.map(String) : []));
    const firstPersonId = draft?.people.find(person => person.active !== false && !assigned.has(String(person._id)))?._id;
    if (!firstPersonId) {
      showToast('Everyone is already assigned for this meal. Edit an existing group first.');
      return;
    }
    mutateDraft(plan => plan.days[dayIndex].meals.push({
      ...emptyMeal(mealType),
      forEveryone: false,
      personIds: [String(firstPersonId)]
    }));
    setActiveMealType(mealType);
    setActiveRowIndex(nextRowIndex);
  };

  const revealSpecialMeal = (dayIndex: number) => {
    const hasSpecialRow = Boolean(draft?.days[dayIndex]?.meals.some(meal => meal.mealType === 'special'));
    const firstPersonId = draft?.people.find(person => person.active !== false)?._id;
    if (!hasSpecialRow) mutateDraft(plan => plan.days[dayIndex].meals.push({
      ...emptyMeal('special'),
      forEveryone: !firstPersonId,
      personIds: firstPersonId ? [String(firstPersonId)] : []
    }));
    setActiveMealType('special');
    setActiveRowIndex(0);
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
    const assignedElsewhere = checked && mealContexts(draft!.days[dayIndex], mealType)
      .some(context => context.rowIndex !== rowIndex && context.meal.forEveryone === false && context.meal.personIds.map(String).includes(personId));
    if (assignedElsewhere) {
      showToast('That person is already assigned to another group for this meal.');
      return;
    }
    mutateDraft(plan => {
      const rows = plan.days[dayIndex].meals
        .map((meal, index) => ({ meal, index }))
        .filter(entry => entry.meal.mealType === mealType);
      const target = rows[rowIndex];
      if (!target) return;
      const next = new Set(target.meal.personIds || []);
      if (checked) next.add(personId); else next.delete(personId);
      plan.days[dayIndex].meals[target.index] = { ...target.meal, forEveryone: false, personIds: [...next], personName: '' };
    });
  };

  const goToWeek = async (targetWeekStart: string) => {
    if (!weekStart || !draft || targetWeekStart === weekStart) return;
    if (!(await saveCurrentDraftIfNeeded())) return;
    setDraft(null);
    setWeekStart(targetWeekStart);
    setSelectedDayIndex(0);
    setActiveMealType('dinner');
    setActiveRowIndex(0);
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
        setSelectedDayIndex(0);
        setActiveMealType('dinner');
        setActiveRowIndex(0);
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
    const date = draft?.days[selectedDayIndex]?.date;
    if (!date || !weekStart) return;
    sessionStorage.setItem('provista-plan-context', JSON.stringify({ weekStart, date, mealType: activeMealType, rowIndex: activeRowIndex }));
  }, [activeMealType, activeRowIndex, draft, selectedDayIndex, weekStart]);

  useEffect(() => {
    if (!draft || firstFocusDoneRef.current) return;
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus !== 'today-dinner' && !onboardingActive) return;
    const todayIndex = draft.days.findIndex(day => day.date === isoDate());
    if (todayIndex < 0) return;
    setSelectedDayIndex(todayIndex);
    setActiveMealType('dinner');
    setActiveRowIndex(0);
    firstFocusDoneRef.current = true;
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('input[data-meal-name="dinner-0"]')?.focus({ preventScroll: true });
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
  const shortageByDate = allocationShortagesByDate(allocationQuery.data);
  const dayStatuses = draft.days.map(day => dayPlanStatus(day, visibleMealTypes, shortageByDate.get(day.date) || 0));
  const selectedDay = draft.days[Math.min(selectedDayIndex, draft.days.length - 1)];
  const selectedDayStatus = dayStatuses[Math.min(selectedDayIndex, dayStatuses.length - 1)];
  const activeContexts = mealContexts(selectedDay, activeMealType);
  const activeContext = activeContexts[activeRowIndex] || activeContexts[0] || null;
  const activeMeal = activeContext?.meal || emptyMeal(activeMealType);
  const effectiveRowIndex = activeContext?.rowIndex || 0;
  const activeKey = mealKey(selectedDayIndex, activeMealType, effectiveRowIndex);
  const activeMealIndex = selectedDay.meals
    .map((meal, index) => ({ meal, index }))
    .filter(entry => entry.meal.mealType === activeMealType)[effectiveRowIndex]?.index;
  const focusedAudienceLabel = (meal: PlanMeal) => meal.forEveryone !== false && activeContexts.some(context => context.meal.forEveryone === false)
    ? 'Everyone else in household'
    : audienceLabel(meal);
  const nextContext = activeMeal.name.trim()
    ? nextUnfinishedContext(selectedDay, activeMealType, effectiveRowIndex)
    : null;
  const nextTarget = activeMeal.name.trim() && !nextContext
    ? nextPlanningTarget(draft.days, visibleMealTypes, selectedDayIndex, activeMealType)
    : null;
  const planningContexts = visibleMealTypes
    .filter(type => type !== 'special')
    .flatMap(type => draft.days.flatMap(day => mealContexts(day, type)));
  const weekFullyPlanned = planningContexts.length > 0 && planningContexts.every(context => context.planned);
  const activeDayAllocations = (allocationQuery.data?.mealAllocations || []).filter(allocation =>
    String(allocation.date || '').slice(0, 10) === selectedDay.date && allocation.mealType === activeMealType && allocation.mealIndex === activeMealIndex
  );
  const activeShoppingCount = activeDayAllocations.filter(allocation => Number(allocation.shoppingQuantity) > 0).length;
  const activeCoveredCount = activeDayAllocations.length - activeShoppingCount;
  const pantryItems = allocationQuery.data?.itemSummaries || [];
  const pantryShortages = pantryItems.filter(item => Number(item.shoppingQuantity) > 0);
  const pantryCovered = pantryItems.length - pantryShortages.length;
  const nearestShortages = pantryShortages.slice(0, 2);

  const goToNextTarget = () => {
    if (!nextTarget) return;
    setSelectedDayIndex(nextTarget.dayIndex);
    setActiveMealType(nextTarget.mealType);
    setActiveRowIndex(nextTarget.rowIndex);
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>(`input[data-meal-name="${nextTarget.mealType}-${nextTarget.rowIndex}"]`)?.focus({ preventScroll: true });
    }, 0);
  };

  const openListDetails = (sourceText: string, quantity: number) => {
    const params = new URLSearchParams({
      from: 'plan',
      detail: sourceText,
      quantity: String(Number(quantity) || 1)
    });
    setShoppingTarget(null);
    navigate(`/app/list?${params.toString()}`);
  };

  return (
    <section className="plan-page" aria-labelledby="plan-title">
      <header className="plan-heading">
        <div>
          <p className="plan-eyebrow">Household meals</p>
          <h1 id="plan-title">Plan</h1>
          <p>Plan what matters this week. Provista saves changes automatically.</p>
        </div>
        <div className={`plan-save-status plan-save-${saveStatus}`} role="status">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? <><span>Not saved</span><button type="button" onClick={() => { if (draft) void queueDraftSave(clonePlan(draft), revisionRef.current); }}>Retry</button></> : dirty ? 'Unsaved changes' : 'Saved ✓'}
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

      {pantryItems.length > 0 && (
        <details className="plan-pantry-outlook">
          <summary>
            <div>
              <strong id="plan-pantry-outlook-title">Pantry outlook</strong>
              <span>{pantryShortages.length} shortage{pantryShortages.length === 1 ? '' : 's'} this week · {pantryCovered} covered</span>
            </div>
            <span>View details</span>
          </summary>
          {nearestShortages.length > 0 && (
            <div className="plan-pantry-outlook-nearest" aria-label="Nearest Pantry shortages">
              {nearestShortages.map(item => <span key={item.itemId}><strong>{item.name}</strong> · Buy {item.shoppingQuantity}{safeDisplayUnit(item.unit)}</span>)}
            </div>
          )}
          <p>Based on saved meal needs. Planning does not change Pantry on-hand quantities.</p>
          <div className="plan-pantry-outlook-items">
            {pantryItems.map(item => {
              const unit = safeDisplayUnit(item.unit);
              const need = item.shoppingQuantity > 0 ? ` · Buy ${item.shoppingQuantity}${unit}` : item.listQuantity > 0 ? ' · Covered on List' : '';
              const detail = item.trackingMode === 'simple'
                ? `Pantry: ${item.pantryStatus === 'have' ? 'Have' : item.pantryStatus === 'low' ? 'Running low' : 'Out'}${need}`
                : `On hand ${item.onHandQuantity || 0}${unit} · Planned ${item.plannedQuantity}${unit} · Projected ${item.projectedQuantity || 0}${unit}${need}`;
              return <div className={item.shoppingQuantity > 0 ? 'plan-pantry-outlook-shortage' : ''} key={item.itemId}><strong>{item.name}</strong><span>{detail}</span></div>;
            })}
          </div>
          {allocationQuery.data?.unresolvedNeeds.length ? <small>{allocationQuery.data.unresolvedNeeds.length} meal need{allocationQuery.data.unresolvedNeeds.length === 1 ? '' : 's'} need a catalog match before Provista can project them.</small> : null}
        </details>
      )}

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

      <nav className="plan-week-overview" aria-label="Days in this plan">
        {draft.days.map((day, dayIndex) => {
          const status = dayStatuses[dayIndex];
          const selected = dayIndex === selectedDayIndex;
          const fullLabel = `${dayLabel(day.date)}, ${status.status}${status.hasSeparateMeal ? ', separate meal' : ''}${status.shortageCount ? `, ${status.shortageCount} shortage${status.shortageCount === 1 ? '' : 's'}` : ''}`;
          return (
            <button
              type="button"
              className={`plan-day plan-day-status-${status.status} ${day.date === today ? 'plan-week-day-today' : ''}`}
              aria-label={fullLabel}
              aria-current={selected ? 'date' : undefined}
              onClick={() => { setSelectedDayIndex(dayIndex); setActiveRowIndex(0); }}
              key={day.date}
            >
              <strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(localDate(day.date))}</strong>
              <span>{localDate(day.date).getDate()}</span>
              <small>{status.status === 'planned' ? 'Planned' : status.status === 'partial' ? 'Partial' : 'Open'}</small>
              {(status.hasSeparateMeal || status.shortageCount > 0) && <em>{status.hasSeparateMeal ? 'Group' : ''}{status.hasSeparateMeal && status.shortageCount ? ' · ' : ''}{status.shortageCount ? `Need ${status.shortageCount}` : ''}</em>}
            </button>
          );
        })}
      </nav>

      <article className={`plan-focused-day ${selectedDay.date === today ? 'plan-day-today' : ''}`} data-plan-day={selectedDayIndex}>
        <header className="plan-focused-day-heading">
          <div><p>Focused day</p><h2>{dayLabel(selectedDay.date)}</h2></div>
          <span>{selectedDayStatus.plannedCount} of {selectedDayStatus.contextCount} planned{selectedDayStatus.shortageCount ? ` · ${selectedDayStatus.shortageCount} shortage${selectedDayStatus.shortageCount === 1 ? '' : 's'}` : ''}</span>
        </header>

        <div className="plan-meal-type-selector" role="tablist" aria-label="Meal type">
          {visibleMealTypes.map(mealType => (
            <button type="button" role="tab" aria-selected={activeMealType === mealType} onClick={() => { setActiveMealType(mealType); setActiveRowIndex(0); }} key={mealType}>
              {MEAL_LABELS[mealType]}
            </button>
          ))}
        </div>

        {activeMealType === 'special' && activeContexts.length === 0 ? (
          <button type="button" className="plan-add-special" disabled={!online} onClick={() => revealSpecialMeal(selectedDayIndex)}>+ Add a separate meal</button>
        ) : (
          <section className="plan-focused-meal plan-meal-section" data-meal-type={activeMealType}>
            <div className="plan-audience-status-list" aria-label={`${MEAL_LABELS[activeMealType]} groups`}>
              {activeContexts.map(context => (
                <button type="button" aria-pressed={context.rowIndex === effectiveRowIndex} onClick={() => setActiveRowIndex(context.rowIndex)} key={mealKey(selectedDayIndex, activeMealType, context.rowIndex)}>
                  <strong>{focusedAudienceLabel(context.meal)}</strong>
                  <span>{context.planned ? `Planned · ${context.meal.name}` : `Needs ${MEAL_LABELS[activeMealType].toLowerCase()}`}</span>
                </button>
              ))}
              {activeMealType !== 'special' && <button type="button" className="plan-add-group" disabled={!online} onClick={() => addSeparateMeal(selectedDayIndex, activeMealType)}>+ Separate group</button>}
            </div>

            <div className="plan-meal-row">
              <div className="plan-active-audience"><span>Planning for</span><strong>{focusedAudienceLabel(activeMeal)}</strong></div>
              <div className="plan-meal-topline">
                <label><span>Meal</span><input data-meal-name={`${activeMealType}-${effectiveRowIndex}`} value={activeMeal.name} disabled={!online} placeholder={activeMealType === 'special' ? 'Separate meal…' : 'Meal…'} onChange={event => updateMeal(selectedDayIndex, activeMealType, effectiveRowIndex, { name: event.target.value })} /></label>
                <details className="plan-audience"><summary>{audienceLabel(activeMeal)} · Change</summary><div>
                  <label><input type="checkbox" checked={activeMeal.forEveryone !== false} disabled={!online} onChange={event => updateMeal(selectedDayIndex, activeMealType, effectiveRowIndex, { forEveryone: event.target.checked, personIds: event.target.checked ? [] : activeMeal.personIds, personName: event.target.checked ? '' : activeMeal.personName || '' })} /> Everyone</label>
                  {draft.people.map(person => <label key={person._id}><input type="checkbox" checked={!activeMeal.forEveryone && activeMeal.personIds.includes(String(person._id))} disabled={!online || activeMeal.forEveryone} onChange={event => togglePerson(selectedDayIndex, activeMealType, effectiveRowIndex, String(person._id), event.target.checked)} /> {person.displayName}{person.historical ? ' (past)' : ''}</label>)}
                </div></details>
              </div>
              <label className="plan-needs-field"><span>Need for this meal</span><textarea value={activeMeal.notes} disabled={!online} maxLength={2000} rows={2} placeholder="e.g. tortillas, lettuce, salsa" onChange={event => updateMeal(selectedDayIndex, activeMealType, effectiveRowIndex, { notes: event.target.value })} /></label>
              {activeDayAllocations.length > 0 && <div className={activeShoppingCount ? 'plan-coverage-summary plan-coverage-shortage' : 'plan-coverage-summary'}>{activeCoveredCount} covered · {activeShoppingCount} need buying</div>}
              {allocationQuery.isError && <div className="plan-coverage-unavailable">Pantry availability unavailable. You can keep planning.</div>}
              <div className="plan-meal-actions">
                {activeMeal.notes.trim() && <button type="button" className="plan-link-button" disabled={!online || shoppingLoading} onClick={() => void openShoppingReview(activeKey, activeMeal.notes)}>Check shopping needs</button>}
                {activeMeal.name.trim() && <button type="button" className="plan-link-button" disabled={!online} onClick={() => repeatMeal(selectedDayIndex, activeMealType, effectiveRowIndex)}>Repeat later this week</button>}
                {!activeMeal.name && !activeMeal.notes && <button type="button" className="plan-link-button" disabled={!online} onClick={() => planLeftovers(selectedDayIndex, activeMealType, effectiveRowIndex)}>Plan leftovers</button>}
                {activeMeal.name.trim() && <button type="button" className="plan-link-button" disabled={!online} onClick={() => void saveAsFavorite(activeMeal)}>Save as favorite</button>}
                <button type="button" className="plan-link-button" disabled={!online} onClick={() => setFavoriteTarget(activeKey)}>Use favorite</button>
                {(activeMealType === 'special' || activeContexts.length > 1) && <button type="button" className="plan-link-button plan-danger-link" disabled={!online} onClick={() => void removeSeparateMeal(selectedDayIndex, activeMealType, effectiveRowIndex)}>Remove meal</button>}
              </div>
            </div>

            {nextContext && <button type="button" className="shell-button shell-button-primary plan-next-context" onClick={() => setActiveRowIndex(nextContext.rowIndex)}>Next: plan for {focusedAudienceLabel(nextContext.meal)}</button>}
            {!nextContext && nextTarget && <button type="button" className="shell-button shell-button-primary plan-next-context" onClick={goToNextTarget}>Next: {dayLabel(draft.days[nextTarget.dayIndex].date)} · {MEAL_LABELS[nextTarget.mealType]}</button>}
            {!nextContext && !nextTarget && weekFullyPlanned && <div className="plan-week-complete" role="status"><strong>Week planned</strong><span>Every meal shown for this week has a plan.</span></div>}
          </section>
        )}
      </article>

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
                        <button type="button" className="plan-link-button" onClick={() => openListDetails(suggestion.sourceText, quantity)}>Add with details in List</button>
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
