const InventoryEvent = require('../models/InventoryEvent');
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const MealPlan = require('../models/MealPlan');
const { appendDelta, roundQuantity } = require('../utils/inventoryLedger');
const { effectiveTrackingMode, flattenMeals } = require('../utils/mealAllocations');
const {
  correctMealConsumption,
  mealSourceIdentity,
  resolveMealNeedsForReconciliation,
  reverseMealConsumption
} = require('../utils/mealReconciliation');

async function findMealContext(householdId, mealInstanceId) {
  const plans = await MealPlan.find({ householdId, 'days.meals.instanceId': mealInstanceId });
  for (const plan of plans) {
    const meal = flattenMeals(plan).find(entry => entry.instanceId === mealInstanceId);
    if (meal) return { plan, meal };
  }
  return null;
}

async function reconciliationStatus(householdId, mealInstanceId) {
  const originals = await InventoryEvent.find({
    householdId,
    type: 'meal_consumption',
    'sourceMeta.mealInstanceId': mealInstanceId
  }).lean();

  if (!originals.length) {
    return { mealInstanceId, updatedPantry: false, reversed: false, items: [] };
  }

  const originalIds = originals.map(event => event._id);
  const [corrections, reversals, items] = await Promise.all([
    InventoryEvent.find({
      householdId,
      type: 'correction',
      'sourceMeta.originalEventId': { $in: originalIds.map(String) }
    }).lean(),
    InventoryEvent.find({ householdId, type: 'reversal', reversesEventId: { $in: originalIds } }).lean(),
    Item.find({ _id: { $in: originals.map(event => event.itemId) }, householdId }).select('name unit').lean()
  ]);

  const itemById = new Map(items.map(item => [String(item._id), item]));
  const correctionByOriginal = new Map();
  corrections.forEach(event => {
    const id = String(event.sourceMeta?.originalEventId || '');
    correctionByOriginal.set(id, roundQuantity((correctionByOriginal.get(id) || 0) + (Number(event.quantityDelta) || 0)));
  });
  const reversedIds = new Set(reversals.map(event => String(event.reversesEventId)));

  return {
    mealInstanceId,
    updatedPantry: true,
    reversed: originals.every(event => reversedIds.has(String(event._id))),
    items: originals.map(event => {
      const correction = correctionByOriginal.get(String(event._id)) || 0;
      const netDelta = roundQuantity((Number(event.quantityDelta) || 0) + correction);
      const item = itemById.get(String(event.itemId));
      return {
        itemId: String(event.itemId),
        name: item?.name || 'Pantry item',
        unit: item?.unit || '',
        trackingMode: event.sourceType === 'meal-plan-simple-usage' ? 'simple' : 'exact',
        consumedQuantity: event.sourceType === 'meal-plan-simple-usage' ? null : Math.max(0, roundQuantity(-netDelta)),
        reversed: reversedIds.has(String(event._id))
      };
    })
  };
}

async function updatePantryFromCurrentMeal({ householdId, mealInstanceId, idempotencyKey, createdBy }) {
  const key = String(idempotencyKey || '').trim();
  if (!key) {
    const error = new Error('idempotencyKey is required');
    error.status = 400;
    throw error;
  }

  const context = await findMealContext(householdId, mealInstanceId);
  if (!context) {
    const error = new Error('Meal was not found');
    error.status = 404;
    throw error;
  }

  const [items, inventoryItems, originals] = await Promise.all([
    Item.find({ householdId }).select('name brand category unit aliases').lean(),
    InventoryItem.find({ householdId }),
    InventoryEvent.find({
      householdId,
      type: 'meal_consumption',
      'sourceMeta.mealInstanceId': mealInstanceId
    })
  ]);

  if (!originals.length) {
    const error = new Error('This meal has not updated Pantry yet');
    error.status = 409;
    throw error;
  }

  const resolved = resolveMealNeedsForReconciliation(context.meal, items, new Map());
  if (resolved.unresolved.length) {
    const error = new Error('Resolve unmatched meal needs before updating Pantry');
    error.status = 409;
    error.unresolved = resolved.unresolved;
    throw error;
  }

  const desiredByItem = new Map(resolved.needs.map(need => [String(need.item._id), need]));
  const originalByItem = new Map(originals.map(event => [String(event.itemId), event]));
  const inventoryByItem = new Map(inventoryItems.map(entry => [String(entry.itemId), entry]));
  const results = [];

  for (const original of originals) {
    if (original.sourceType === 'meal-plan-simple-usage') continue;
    const itemId = String(original.itemId);
    const desired = desiredByItem.get(itemId)?.quantity || 0;
    results.push(await correctMealConsumption({
      householdId,
      mealInstanceId,
      itemId,
      actualQuantity: desired,
      idempotencyKey: `${key}:${itemId}`,
      createdBy
    }));
  }

  for (const need of resolved.needs) {
    const itemId = String(need.item._id);
    if (originalByItem.has(itemId)) continue;
    const inventory = inventoryByItem.get(itemId);
    if (!inventory) continue;

    const sourceIdentity = mealSourceIdentity({
      householdId: String(householdId),
      planId: String(context.plan._id),
      meal: context.meal,
      itemId
    });
    const simple = effectiveTrackingMode(inventory) !== 'exact';
    await appendDelta(inventory, 'meal_consumption', simple ? 0 : -Math.abs(need.quantity), {
      effectiveAt: new Date(`${context.meal.dateKey}T00:00:00.000Z`),
      sourceIdentity,
      sourceType: simple ? 'meal-plan-simple-usage' : 'meal-plan',
      sourceEntityId: String(context.plan._id),
      sourceMeta: {
        reconciliationVersion: 1,
        mealInstanceId,
        mealDate: context.meal.dateKey,
        mealType: context.meal.mealType,
        mealName: context.meal.mealName,
        sourceTexts: need.sourceTexts,
        ...(simple ? { trackingMode: 'simple', uncertainAfterUse: true } : {})
      },
      createdBy
    });
    results.push({ mealInstanceId, itemId, actualQuantity: need.quantity, changed: true, added: true });
  }

  return { status: await reconciliationStatus(householdId, mealInstanceId), changes: results };
}

module.exports = {
  reconciliationStatus,
  reverseMealConsumption,
  updatePantryFromCurrentMeal
};
