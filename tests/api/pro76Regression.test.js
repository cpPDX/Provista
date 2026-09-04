const mongoose = require('mongoose');
const db = require('../helpers/db');
const InventoryEvent = require('../../models/InventoryEvent');
const InventoryItem = require('../../models/InventoryItem');
const Item = require('../../models/Item');
const MealPlan = require('../../models/MealPlan');
const { appendDelta } = require('../../utils/inventoryLedger');
const { buildMealAllocationProjection } = require('../../utils/mealAllocations');
const {
  reconciliationStatus,
  updatePantryFromCurrentMeal
} = require('../../services/mealReconciliationActions');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

function oid() {
  return new mongoose.Types.ObjectId();
}

function planWithMeals(mealsByDate) {
  return {
    weekStart: new Date('2026-09-01T00:00:00.000Z'),
    days: Object.entries(mealsByDate).map(([date, meals]) => ({
      date: new Date(`${date}T00:00:00.000Z`),
      meals
    }))
  };
}

describe('PRO-76 reservation and leftovers semantics', () => {
  it('does not reserve a past meal again after its date has passed', () => {
    const item = { _id: oid(), name: 'Chicken breasts', unit: 'each' };
    const inventory = { itemId: item._id, trackingMode: 'exact', quantity: 4, unit: 'each' };
    const plan = planWithMeals({
      '2026-09-01': [{ instanceId: 'past', mealType: 'dinner', name: 'Chicken', notes: '2 chicken breasts' }],
      '2026-09-03': [{ instanceId: 'today', mealType: 'dinner', name: 'Chicken', notes: '3 chicken breasts' }]
    });

    const projection = buildMealAllocationProjection({
      plan,
      items: [item],
      inventoryItems: [inventory],
      notBeforeDateKey: '2026-09-03'
    });

    expect(projection.mealAllocations).toHaveLength(1);
    expect(projection.mealAllocations[0].instanceId).toBe('today');
    expect(projection.itemSummaries[0].plannedQuantity).toBe(3);
    expect(projection.itemSummaries[0].projectedQuantity).toBe(1);
  });

  it('does not consume source ingredients again for a leftovers meal with no explicit needs', () => {
    const item = { _id: oid(), name: 'Chicken breasts', unit: 'each' };
    const plan = planWithMeals({
      '2026-09-03': [{ instanceId: 'leftovers', mealType: 'dinner', name: 'Leftovers', notes: '' }]
    });

    const projection = buildMealAllocationProjection({
      plan,
      items: [item],
      inventoryItems: [{ itemId: item._id, trackingMode: 'exact', quantity: 2 }]
    });

    expect(projection.mealAllocations).toHaveLength(0);
    expect(projection.itemSummaries).toHaveLength(0);
  });

  it('treats explicit extra needs on a leftovers meal as normal needs', () => {
    const item = { _id: oid(), name: 'Milk', unit: 'cup' };
    const plan = planWithMeals({
      '2026-09-03': [{ instanceId: 'leftovers', mealType: 'dinner', name: 'Leftovers', notes: '1 milk' }]
    });

    const projection = buildMealAllocationProjection({
      plan,
      items: [item],
      inventoryItems: [{ itemId: item._id, trackingMode: 'exact', quantity: 2, unit: 'cup' }]
    });

    expect(projection.mealAllocations).toHaveLength(1);
    expect(projection.mealAllocations[0]).toMatchObject({ instanceId: 'leftovers', quantity: 1 });
    expect(projection.itemSummaries[0].projectedQuantity).toBe(1);
  });
});

describe('PRO-76 explicit reconciled meal actions', () => {
  async function fixture() {
    const householdId = oid();
    const item = await Item.create({
      householdId,
      name: 'Chicken breasts',
      category: 'Meat & Seafood',
      unit: 'each'
    });
    const inventory = await InventoryItem.create({
      householdId,
      itemId: item._id,
      trackingMode: 'exact',
      quantity: 4,
      stockStatus: 'have',
      unit: 'each',
      lastUpdated: new Date('2026-09-01T00:00:00.000Z')
    });
    const plan = await MealPlan.create({
      householdId,
      weekStart: new Date('2026-09-01T00:00:00.000Z'),
      days: [{
        date: new Date('2026-09-01T00:00:00.000Z'),
        meals: [{
          instanceId: 'meal-1',
          mealType: 'dinner',
          forEveryone: true,
          personIds: [],
          name: 'Chicken dinner',
          notes: '2 chicken breasts'
        }]
      }]
    });
    await appendDelta(inventory, 'meal_consumption', -2, {
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      sourceIdentity: `meal-consumption:v1:${householdId}:meal-1:${item._id}`,
      sourceType: 'meal-plan',
      sourceEntityId: String(plan._id),
      sourceMeta: {
        reconciliationVersion: 1,
        mealInstanceId: 'meal-1',
        mealDate: '2026-09-01',
        mealName: 'Chicken dinner'
      }
    });
    return { householdId, item, inventory, plan };
  }

  it('reports that a reconciled meal already updated Pantry', async () => {
    const data = await fixture();
    const status = await reconciliationStatus(data.householdId, 'meal-1');
    expect(status.updatedPantry).toBe(true);
    expect(status.reversed).toBe(false);
    expect(status.items).toEqual([
      expect.objectContaining({ name: 'Chicken breasts', consumedQuantity: 2, trackingMode: 'exact' })
    ]);
  });

  it('updates Pantry by deltas only when the reconciled Plan meal is deliberately changed', async () => {
    const data = await fixture();
    expect((await InventoryItem.findById(data.inventory._id)).quantity).toBe(2);

    data.plan.days[0].meals[0].notes = '3 chicken breasts';
    data.plan.markModified('days');
    await data.plan.save();
    await updatePantryFromCurrentMeal({
      householdId: data.householdId,
      mealInstanceId: 'meal-1',
      idempotencyKey: 'edit-to-3'
    });
    expect((await InventoryItem.findById(data.inventory._id)).quantity).toBe(1);

    data.plan.days[0].meals[0].notes = '1 chicken breasts';
    data.plan.markModified('days');
    await data.plan.save();
    await updatePantryFromCurrentMeal({
      householdId: data.householdId,
      mealInstanceId: 'meal-1',
      idempotencyKey: 'edit-to-1'
    });
    expect((await InventoryItem.findById(data.inventory._id)).quantity).toBe(3);

    const corrections = await InventoryEvent.find({ householdId: data.householdId, type: 'correction' });
    expect(corrections.map(event => event.quantityDelta).sort()).toEqual([-1, 2]);
  });

  it('enforces one authoritative event under concurrent source replay', async () => {
    const householdId = oid();
    const item = await Item.create({ householdId, name: 'Rice', category: 'Pantry', unit: 'cup' });
    const inventory = await InventoryItem.create({
      householdId,
      itemId: item._id,
      trackingMode: 'exact',
      quantity: 4,
      stockStatus: 'have'
    });

    await Promise.all([
      appendDelta(inventory, 'meal_consumption', -1, {
        sourceIdentity: 'same-source',
        sourceType: 'meal-plan',
        sourceMeta: { mealInstanceId: 'same-meal' }
      }),
      appendDelta(inventory, 'meal_consumption', -1, {
        sourceIdentity: 'same-source',
        sourceType: 'meal-plan',
        sourceMeta: { mealInstanceId: 'same-meal' }
      })
    ]);

    expect(await InventoryEvent.countDocuments({ householdId, sourceIdentity: 'same-source' })).toBe(1);
    expect((await InventoryItem.findById(inventory._id)).quantity).toBe(3);
  });
});
