const { matchCatalogItem } = require('./itemMatching');
const { parseMealShoppingNotes } = require('./mealShopping');

const MEAL_ORDER = new Map([
  ['breakfast', 0],
  ['lunch', 1],
  ['dinner', 2],
  ['special', 3]
]);

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function positiveQuantity(value, fallback = 0) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? roundQuantity(quantity) : fallback;
}

function itemId(value) {
  return String(value?._id || value || '');
}

function safeUnit(value) {
  const unit = String(value || '').trim();
  return unit && !/^\d+(?:\.\d+)?$/.test(unit) ? unit : '';
}

function effectiveTrackingMode(inventory) {
  if (!inventory) return null;
  if (inventory.trackingMode === 'exact' || inventory.lowStockThreshold != null) return 'exact';
  return 'simple';
}

function simpleStatus(inventory) {
  if (['have', 'low', 'out'].includes(inventory?.stockStatus)) return inventory.stockStatus;
  return Number(inventory?.quantity) <= 0 ? 'out' : 'have';
}

function aggregateListQuantities(listItems = []) {
  const quantities = new Map();
  for (const entry of listItems) {
    if (entry?.checked === true) continue;
    const id = itemId(entry?.itemId);
    if (!id) continue;
    quantities.set(id, roundQuantity((quantities.get(id) || 0) + positiveQuantity(entry.quantity, 1)));
  }
  return quantities;
}

function flattenMeals(plan) {
  const meals = [];
  for (const [dayIndex, day] of (plan?.days || []).entries()) {
    const date = new Date(day?.date);
    if (Number.isNaN(date.getTime())) continue;
    for (const [mealIndex, meal] of (day?.meals || []).entries()) {
      if (!String(meal?.notes || '').trim()) continue;
      meals.push({
        date,
        dateKey: date.toISOString().slice(0, 10),
        dayIndex,
        mealIndex,
        mealType: meal.mealType,
        mealName: String(meal.name || '').trim(),
        notes: meal.notes
      });
    }
  }

  return meals.sort((left, right) =>
    left.date - right.date ||
    (MEAL_ORDER.get(left.mealType) ?? 99) - (MEAL_ORDER.get(right.mealType) ?? 99) ||
    left.mealIndex - right.mealIndex
  );
}

function resolveMealNeeds(meal, items, usageByItemId) {
  const resolved = new Map();
  const unresolved = [];

  for (const parsed of parseMealShoppingNotes(meal.notes)) {
    const match = matchCatalogItem(parsed, items, { usageByItemId });
    if (match.matchStatus !== 'matched' || !match.item) {
      unresolved.push({
        date: meal.dateKey,
        dayIndex: meal.dayIndex,
        mealIndex: meal.mealIndex,
        mealType: meal.mealType,
        mealName: meal.mealName,
        sourceText: parsed.sourceText,
        quantity: parsed.quantity,
        matchStatus: match.matchStatus
      });
      continue;
    }

    const id = itemId(match.item);
    const existing = resolved.get(id);
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + parsed.quantity);
      existing.sourceTexts.push(parsed.sourceText);
      continue;
    }

    resolved.set(id, {
      item: match.item,
      quantity: positiveQuantity(parsed.quantity, 1),
      sourceTexts: [parsed.sourceText]
    });
  }

  return { needs: [...resolved.values()], unresolved };
}

function projectionState(item, inventory, listQuantity) {
  const mode = effectiveTrackingMode(inventory);
  const exactQuantity = Math.max(0, Number(inventory?.quantity) || 0);
  const exactThreshold = mode === 'exact' && inventory?.lowStockThreshold != null
    ? Math.max(0, Number(inventory.lowStockThreshold) || 0)
    : null;
  return {
    item,
    inventory,
    mode,
    pantryStatus: mode === 'simple'
      ? simpleStatus(inventory)
      : (!inventory ? 'not-tracked' : exactQuantity <= 0 ? 'out' : exactThreshold != null && exactQuantity <= exactThreshold ? 'low' : 'have'),
    onHandQuantity: mode === 'simple' ? null : exactQuantity,
    lowStockThreshold: exactThreshold,
    listQuantity: positiveQuantity(listQuantity),
    plannedQuantity: 0
  };
}

function exactAllocation(state, requestedQuantity) {
  const previousPlanned = state.plannedQuantity;
  const nextPlanned = roundQuantity(previousPlanned + requestedQuantity);
  const availableBefore = Math.max(0, roundQuantity(state.onHandQuantity - previousPlanned));
  const projectedAfter = Math.max(0, roundQuantity(state.onHandQuantity - nextPlanned));
  const previousShortage = Math.max(0, roundQuantity(previousPlanned - state.onHandQuantity));
  const nextShortage = Math.max(0, roundQuantity(nextPlanned - state.onHandQuantity));
  const shortageQuantity = roundQuantity(nextShortage - previousShortage);
  const previousUncovered = Math.max(0, roundQuantity(previousShortage - state.listQuantity));
  const nextUncovered = Math.max(0, roundQuantity(nextShortage - state.listQuantity));
  const shoppingQuantity = roundQuantity(nextUncovered - previousUncovered);
  state.plannedQuantity = nextPlanned;

  return {
    availableBefore,
    projectedAfter,
    shortageQuantity,
    shoppingQuantity,
    coverageStatus: shortageQuantity <= 0
      ? 'covered'
      : (shoppingQuantity <= 0 ? 'on-list' : 'shortage')
  };
}

function simpleAllocation(state, requestedQuantity) {
  const previousPlanned = state.plannedQuantity;
  const nextPlanned = roundQuantity(previousPlanned + requestedQuantity);
  const needsShopping = state.pantryStatus !== 'have';
  const previousUncovered = needsShopping
    ? Math.max(0, roundQuantity(previousPlanned - state.listQuantity))
    : 0;
  const nextUncovered = needsShopping
    ? Math.max(0, roundQuantity(nextPlanned - state.listQuantity))
    : 0;
  const shoppingQuantity = roundQuantity(nextUncovered - previousUncovered);
  state.plannedQuantity = nextPlanned;

  return {
    availableBefore: null,
    projectedAfter: null,
    shortageQuantity: null,
    shoppingQuantity,
    coverageStatus: state.pantryStatus === 'have'
      ? 'qualitative-have'
      : (shoppingQuantity <= 0 ? 'on-list' : `qualitative-${state.pantryStatus}`)
  };
}

function itemSummary(state) {
  const exact = state.mode !== 'simple';
  const shortageQuantity = exact
    ? Math.max(0, roundQuantity(state.plannedQuantity - state.onHandQuantity))
    : null;
  const shoppingQuantity = exact
    ? Math.max(0, roundQuantity(shortageQuantity - state.listQuantity))
    : (state.pantryStatus === 'have'
      ? 0
      : Math.max(0, roundQuantity(state.plannedQuantity - state.listQuantity)));
  const projectedQuantity = exact
    ? Math.max(0, roundQuantity(state.onHandQuantity - state.plannedQuantity))
    : null;

  return {
    itemId: itemId(state.item),
    name: state.item.name,
    unit: safeUnit(state.inventory?.unit) || safeUnit(state.item.unit),
    trackingMode: state.mode,
    pantryStatus: state.pantryStatus,
    onHandQuantity: state.onHandQuantity,
    plannedQuantity: state.plannedQuantity,
    projectedQuantity,
    lowStockThreshold: state.lowStockThreshold,
    belowLowStockThreshold: exact && state.lowStockThreshold != null
      ? projectedQuantity <= state.lowStockThreshold
      : null,
    shortageQuantity,
    listQuantity: state.listQuantity,
    shoppingQuantity
  };
}

function buildMealAllocationProjection({
  plan,
  items = [],
  inventoryItems = [],
  listItems = [],
  usageByItemId = new Map()
}) {
  const inventoryByItemId = new Map(inventoryItems.map(entry => [itemId(entry.itemId), entry]));
  const listQuantities = aggregateListQuantities(listItems);
  const states = new Map();
  const mealAllocations = [];
  const unresolvedNeeds = [];

  for (const meal of flattenMeals(plan)) {
    const resolved = resolveMealNeeds(meal, items, usageByItemId);
    unresolvedNeeds.push(...resolved.unresolved);

    for (const need of resolved.needs) {
      const id = itemId(need.item);
      let state = states.get(id);
      if (!state) {
        state = projectionState(need.item, inventoryByItemId.get(id), listQuantities.get(id));
        states.set(id, state);
      }

      const projection = state.mode === 'simple'
        ? simpleAllocation(state, need.quantity)
        : exactAllocation(state, need.quantity);
      mealAllocations.push({
        date: meal.dateKey,
        dayIndex: meal.dayIndex,
        mealIndex: meal.mealIndex,
        mealType: meal.mealType,
        mealName: meal.mealName,
        itemId: id,
        name: need.item.name,
        unit: safeUnit(state.inventory?.unit) || safeUnit(need.item.unit),
        sourceTexts: need.sourceTexts,
        quantity: need.quantity,
        trackingMode: state.mode,
        pantryStatus: state.pantryStatus,
        onHandQuantity: state.onHandQuantity,
        listQuantity: state.listQuantity,
        ...projection
      });
    }
  }

  const itemSummaries = [...states.values()]
    .map(itemSummary)
    .sort((left, right) => left.name.localeCompare(right.name));

  const planWeekStart = plan?.weekStart ? new Date(plan.weekStart) : null;
  return {
    weekStart: planWeekStart && !Number.isNaN(planWeekStart.getTime())
      ? planWeekStart.toISOString().slice(0, 10)
      : null,
    itemSummaries,
    mealAllocations,
    unresolvedNeeds
  };
}

module.exports = {
  aggregateListQuantities,
  buildMealAllocationProjection,
  effectiveTrackingMode,
  flattenMeals,
  roundQuantity,
  safeUnit
};
