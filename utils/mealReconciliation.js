const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const MealPlan = require('../models/MealPlan');
const { appendDelta, roundQuantity } = require('./inventoryLedger');
const { matchCatalogItem } = require('./itemMatching');
const { effectiveTrackingMode, flattenMeals } = require('./mealAllocations');
const { parseMealShoppingNotes } = require('./mealShopping');

const RECONCILIATION_VERSION = 1;

function localDateKey(now = new Date(), timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mealSourceIdentity({ householdId, planId, meal, itemId }) {
  return [
    'meal-consumption',
    `v${RECONCILIATION_VERSION}`,
    householdId,
    planId,
    meal.dateKey,
    meal.dayIndex,
    meal.mealIndex,
    itemId
  ].join(':');
}

function resolveMealNeedsForReconciliation(meal, items, usageByItemId = new Map()) {
  const resolved = new Map();
  const unresolved = [];

  for (const parsed of parseMealShoppingNotes(meal.notes)) {
    const match = matchCatalogItem(parsed, items, { usageByItemId });
    if (match.matchStatus !== 'matched' || !match.item) {
      unresolved.push({
        date: meal.dateKey,
        dayIndex: meal.dayIndex,
        mealIndex: meal.mealIndex,
        mealName: meal.mealName,
        sourceText: parsed.sourceText,
        quantity: parsed.quantity,
        matchStatus: match.matchStatus
      });
      continue;
    }

    const id = String(match.item._id);
    const existing = resolved.get(id);
    if (existing) {
      existing.quantity = roundQuantity(existing.quantity + (Number(parsed.quantity) || 0));
      existing.sourceTexts.push(parsed.sourceText);
    } else {
      resolved.set(id, {
        item: match.item,
        quantity: roundQuantity(Number(parsed.quantity) || 1),
        sourceTexts: [parsed.sourceText]
      });
    }
  }

  return { needs: [...resolved.values()], unresolved };
}

async function reconcileHouseholdMeals({ householdId, timeZone = 'UTC', now = new Date() }) {
  const today = localDateKey(now, timeZone);
  const [plans, items, inventoryItems] = await Promise.all([
    MealPlan.find({ householdId }).sort({ weekStart: 1 }).lean(),
    Item.find({ householdId }).select('name brand category unit aliases').lean(),
    InventoryItem.find({ householdId })
  ]);

  const inventoryByItemId = new Map(inventoryItems.map(entry => [String(entry.itemId), entry]));
  const usageByItemId = new Map(inventoryItems.map(entry => [String(entry.itemId), 3]));
  const result = {
    createdOrReused: 0,
    simpleUsageRecorded: 0,
    unresolved: [],
    skippedUntracked: 0
  };

  for (const plan of plans) {
    for (const meal of flattenMeals(plan)) {
      if (meal.dateKey >= today) continue;
      const resolved = resolveMealNeedsForReconciliation(meal, items, usageByItemId);
      result.unresolved.push(...resolved.unresolved.map(entry => ({ ...entry, planId: String(plan._id) })));

      for (const need of resolved.needs) {
        const itemId = String(need.item._id);
        const inventory = inventoryByItemId.get(itemId);
        if (!inventory) {
          result.skippedUntracked += 1;
          continue;
        }

        const sourceIdentity = mealSourceIdentity({
          householdId: String(householdId),
          planId: String(plan._id),
          meal,
          itemId
        });
        const trackingMode = effectiveTrackingMode(inventory);
        const commonMeta = {
          reconciliationVersion: RECONCILIATION_VERSION,
          mealDate: meal.dateKey,
          dayIndex: meal.dayIndex,
          mealIndex: meal.mealIndex,
          mealType: meal.mealType,
          mealName: meal.mealName,
          sourceTexts: need.sourceTexts,
          trackingMode
        };

        if (trackingMode === 'simple') {
          await appendDelta(inventory, 'meal_consumption', 0, {
            effectiveAt: new Date(`${meal.dateKey}T12:00:00.000Z`),
            sourceIdentity,
            sourceType: 'meal-plan',
            sourceEntityId: String(plan._id),
            sourceMeta: {
              ...commonMeta,
              uncertainQuantity: true,
              plannedQuantity: need.quantity
            }
          });
          result.createdOrReused += 1;
          result.simpleUsageRecorded += 1;
          continue;
        }

        await appendDelta(inventory, 'meal_consumption', -Math.abs(need.quantity), {
          effectiveAt: new Date(`${meal.dateKey}T12:00:00.000Z`),
          sourceIdentity,
          sourceType: 'meal-plan',
          sourceEntityId: String(plan._id),
          sourceMeta: commonMeta
        });
        result.createdOrReused += 1;
      }
    }
  }

  return result;
}

module.exports = {
  RECONCILIATION_VERSION,
  localDateKey,
  mealSourceIdentity,
  reconcileHouseholdMeals,
  resolveMealNeedsForReconciliation
};