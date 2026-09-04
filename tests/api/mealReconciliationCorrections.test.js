const mongoose = require('mongoose');
const db = require('../helpers/db');
const InventoryEvent = require('../../models/InventoryEvent');
const InventoryItem = require('../../models/InventoryItem');
const Item = require('../../models/Item');
const {
  appendAbsoluteCount,
  appendDelta
} = require('../../utils/inventoryLedger');
const {
  correctMealConsumption,
  reverseMealConsumption
} = require('../../utils/mealReconciliation');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function exactInventory(quantity = 4) {
  const householdId = new mongoose.Types.ObjectId();
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
    quantity,
    stockStatus: 'have',
    unit: 'each',
    lastUpdated: new Date('2026-09-01T00:00:00.000Z')
  });
  return { householdId, item, inventory };
}

async function consumeMeal({ householdId, item, inventory, instanceId = 'meal-1', quantity = 2 }) {
  return appendDelta(inventory, 'meal_consumption', -quantity, {
    effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
    sourceIdentity: `meal-consumption:v1:${householdId}:${instanceId}:${item._id}`,
    sourceType: 'meal-plan',
    sourceEntityId: 'plan-1',
    sourceMeta: {
      reconciliationVersion: 1,
      mealInstanceId: instanceId,
      mealDate: '2026-09-01',
      mealName: 'Dinner'
    }
  });
}

describe('reconciled meal corrections', () => {
  it('reverses a skipped meal once and retains the original event', async () => {
    const fixture = await exactInventory(4);
    const original = await consumeMeal(fixture);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(2);

    const first = await reverseMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1'
    });
    expect(first.reversedCount).toBe(1);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(4);

    const second = await reverseMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1'
    });
    expect(second.reversedCount).toBe(1);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(4);

    const events = await InventoryEvent.find({ householdId: fixture.householdId });
    expect(events.filter(event => event.type === 'meal_consumption')).toHaveLength(1);
    const reversals = events.filter(event => event.type === 'reversal');
    expect(reversals).toHaveLength(1);
    expect(String(reversals[0].reversesEventId)).toBe(String(original._id));
  });

  it('does not let undo of an older meal override a newer physical count', async () => {
    const fixture = await exactInventory(4);
    await consumeMeal(fixture);
    await appendAbsoluteCount(fixture.inventory, 3, {
      effectiveAt: new Date('2026-09-02T00:00:00.000Z'),
      sourceIdentity: 'physical-count-1',
      sourceType: 'pantry-edit'
    });
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(3);

    await reverseMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1'
    });
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(3);
  });

  it('records only the difference when actual consumption changes', async () => {
    const fixture = await exactInventory(4);
    await consumeMeal(fixture);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(2);

    const first = await correctMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1',
      itemId: fixture.item._id,
      actualQuantity: 1,
      idempotencyKey: 'correction-1'
    });
    expect(first.correctionDelta).toBe(1);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(3);

    const repeated = await correctMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1',
      itemId: fixture.item._id,
      actualQuantity: 1,
      idempotencyKey: 'correction-1'
    });
    expect(repeated.changed).toBe(false);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(3);

    const second = await correctMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1',
      itemId: fixture.item._id,
      actualQuantity: 1.5,
      idempotencyKey: 'correction-2'
    });
    expect(second.correctionDelta).toBe(-0.5);
    expect((await InventoryItem.findById(fixture.inventory._id)).quantity).toBe(2.5);

    const corrections = await InventoryEvent.find({
      householdId: fixture.householdId,
      type: 'correction'
    }).sort({ recordedAt: 1 });
    expect(corrections.map(event => event.quantityDelta)).toEqual([1, -0.5]);
  });

  it('rejects corrections after the meal usage was reversed', async () => {
    const fixture = await exactInventory(4);
    await consumeMeal(fixture);
    await reverseMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1'
    });

    await expect(correctMealConsumption({
      householdId: fixture.householdId,
      mealInstanceId: 'meal-1',
      itemId: fixture.item._id,
      actualQuantity: 1,
      idempotencyKey: 'late-correction'
    })).rejects.toMatchObject({ status: 409 });
  });
});
