const InventoryEvent = require('../models/InventoryEvent');
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const MealPlan = require('../models/MealPlan');
const { appendDelta, roundQuantity, syncMaterializedQuantity } = require('./inventoryLedger');
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
  const mealIdentity = meal.instanceId || [planId, meal.dateKey, meal.dayIndex, meal.mealIndex].join(':');
  return [
    'meal-consumption',
    `v${RECONCILIATION_VERSION}`,
    householdId,
    mealIdentity,
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
        instanceId: meal.instanceId,
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

async function persistLegacyMealIdentities(householdId) {
  // Query the stored BSON rather than hydrated documents: the schema default can
  // make a missing legacy value look present in memory even before it is saved.
  const legacyPlans = await MealPlan.find({
    householdId,
    'days.meals.instanceId': { $exists: false }
  });
  for (const plan of legacyPlans) {
    plan.markModified('days');
    await plan.save();
  }
}

async function reconcileHouseholdMeals({ householdId, timeZone = 'UTC', now = new Date() }) {
  const today = localDateKey(now, timeZone);
  await persistLegacyMealIdentities(householdId);
  const plans = await MealPlan.find({ householdId }).sort({ weekStart: 1 });

  const [items, inventoryItems] = await Promise.all([
    Item.find({ householdId }).select('name brand category unit aliases').lean(),
    InventoryItem.find({ householdId })
  ]);

  const inventoryByItemId = new Map(inventoryItems.map(entry => [String(entry.itemId), entry]));
  const usageByItemId = new Map(inventoryItems.map(entry => [String(entry.itemId), 3]));
  const result = { createdOrReused: 0, unresolved: [], skippedSimple: 0, skippedUntracked: 0 };

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
        const sourceMeta = {
          reconciliationVersion: RECONCILIATION_VERSION,
          mealInstanceId: meal.instanceId,
          mealDate: meal.dateKey,
          dayIndex: meal.dayIndex,
          mealIndex: meal.mealIndex,
          mealType: meal.mealType,
          mealName: meal.mealName,
          sourceTexts: need.sourceTexts
        };

        if (effectiveTrackingMode(inventory) !== 'exact') {
          // Retain an idempotent usage/uncertainty signal without making simple
          // tracking quantitative or changing Have / Running low / Out.
          await appendDelta(inventory, 'meal_consumption', 0, {
            effectiveAt: new Date(`${meal.dateKey}T00:00:00.000Z`),
            sourceIdentity,
            sourceType: 'meal-plan-simple-usage',
            sourceEntityId: String(plan._id),
            sourceMeta: { ...sourceMeta, trackingMode: 'simple', uncertainAfterUse: true }
          });
          result.skippedSimple += 1;
          result.createdOrReused += 1;
          continue;
        }

        await appendDelta(inventory, 'meal_consumption', -Math.abs(need.quantity), {
          // Effective date is authoritative; no meal-time assumption is invented.
          effectiveAt: new Date(`${meal.dateKey}T00:00:00.000Z`),
          sourceIdentity,
          sourceType: 'meal-plan',
          sourceEntityId: String(plan._id),
          sourceMeta
        });
        result.createdOrReused += 1;
      }
    }
  }

  return result;
}

async function mealConsumptionEvents(householdId, mealInstanceId) {
  return InventoryEvent.find({
    householdId,
    type: 'meal_consumption',
    'sourceMeta.mealInstanceId': mealInstanceId
  }).sort({ effectiveAt: 1, recordedAt: 1, _id: 1 });
}

async function reverseMealConsumption({ householdId, mealInstanceId, createdBy = null }) {
  const originals = await mealConsumptionEvents(householdId, mealInstanceId);
  const reversedInventoryIds = new Set();
  let reversedCount = 0;

  for (const original of originals) {
    const inventory = await InventoryItem.findOne({
      _id: original.inventoryItemId,
      householdId
    });
    if (!inventory) continue;

    await appendDelta(inventory, 'reversal', -(Number(original.quantityDelta) || 0), {
      // Reverse at the original effective time so a newer absolute physical
      // count still supersedes both the consumption and its reversal.
      effectiveAt: original.effectiveAt,
      sourceIdentity: `meal-reversal:${original._id}`,
      sourceType: 'meal-plan-undo',
      sourceEntityId: original.sourceEntityId,
      sourceMeta: {
        mealInstanceId,
        originalEventId: String(original._id),
        reason: 'meal-not-made'
      },
      reversesEventId: original._id,
      createdBy
    });
    reversedInventoryIds.add(String(inventory._id));
    reversedCount += 1;
  }

  return {
    mealInstanceId,
    reversedCount,
    inventoryItemCount: reversedInventoryIds.size
  };
}

async function correctMealConsumption({
  householdId,
  mealInstanceId,
  itemId,
  actualQuantity,
  idempotencyKey,
  createdBy = null
}) {
  const desired = Number(actualQuantity);
  if (!Number.isFinite(desired) || desired < 0) {
    const error = new Error('actualQuantity must be a non-negative number');
    error.status = 400;
    throw error;
  }
  const key = String(idempotencyKey || '').trim();
  if (!key) {
    const error = new Error('idempotencyKey is required');
    error.status = 400;
    throw error;
  }

  const original = await InventoryEvent.findOne({
    householdId,
    itemId,
    type: 'meal_consumption',
    'sourceMeta.mealInstanceId': mealInstanceId
  });
  if (!original) {
    const error = new Error('No reconciled Pantry usage was found for this meal item');
    error.status = 404;
    throw error;
  }

  const reversed = await InventoryEvent.exists({
    householdId,
    type: 'reversal',
    reversesEventId: original._id
  });
  if (reversed) {
    const error = new Error('This meal usage was already reversed');
    error.status = 409;
    throw error;
  }

  const corrections = await InventoryEvent.find({
    householdId,
    itemId,
    type: 'correction',
    'sourceMeta.originalEventId': String(original._id)
  }).lean();
  const currentDelta = roundQuantity(
    (Number(original.quantityDelta) || 0) +
    corrections.reduce((sum, event) => sum + (Number(event.quantityDelta) || 0), 0)
  );
  const desiredDelta = -roundQuantity(desired);
  const correctionDelta = roundQuantity(desiredDelta - currentDelta);

  const inventory = await InventoryItem.findOne({
    _id: original.inventoryItemId,
    householdId
  });
  if (!inventory) {
    const error = new Error('Pantry item was not found');
    error.status = 404;
    throw error;
  }

  if (correctionDelta === 0) {
    await syncMaterializedQuantity(inventory);
    return {
      mealInstanceId,
      itemId: String(itemId),
      actualQuantity: roundQuantity(desired),
      correctionDelta: 0,
      changed: false
    };
  }

  await appendDelta(inventory, 'correction', correctionDelta, {
    effectiveAt: original.effectiveAt,
    sourceIdentity: `meal-correction:${original._id}:${key}`,
    sourceType: 'meal-plan-correction',
    sourceEntityId: original.sourceEntityId,
    sourceMeta: {
      mealInstanceId,
      originalEventId: String(original._id),
      actualQuantity: roundQuantity(desired),
      previousConsumption: roundQuantity(Math.max(0, -currentDelta))
    },
    createdBy
  });

  return {
    mealInstanceId,
    itemId: String(itemId),
    actualQuantity: roundQuantity(desired),
    correctionDelta,
    changed: true
  };
}

module.exports = {
  RECONCILIATION_VERSION,
  correctMealConsumption,
  localDateKey,
  mealSourceIdentity,
  reconcileHouseholdMeals,
  resolveMealNeedsForReconciliation,
  reverseMealConsumption
};
