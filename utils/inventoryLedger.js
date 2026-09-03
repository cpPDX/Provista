const InventoryEvent = require('../models/InventoryEvent');

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function eventOrder(left, right) {
  const effective = new Date(left.effectiveAt) - new Date(right.effectiveAt);
  if (effective !== 0) return effective;
  const recorded = new Date(left.recordedAt || left.createdAt || 0) - new Date(right.recordedAt || right.createdAt || 0);
  if (recorded !== 0) return recorded;
  return String(left._id || '').localeCompare(String(right._id || ''));
}

function deriveQuantity(events = [], fallbackQuantity = 0) {
  let quantity = Math.max(0, Number(fallbackQuantity) || 0);
  for (const event of [...events].sort(eventOrder)) {
    if (event.absoluteQuantity != null) {
      quantity = Math.max(0, Number(event.absoluteQuantity) || 0);
      continue;
    }
    quantity = Math.max(0, roundQuantity(quantity + (Number(event.quantityDelta) || 0)));
  }
  return roundQuantity(quantity);
}

async function ensureBaselineEvent(inventoryItem) {
  const existing = await InventoryEvent.findOne({
    householdId: inventoryItem.householdId,
    inventoryItemId: inventoryItem._id,
    type: 'baseline'
  }).lean();
  if (existing) return existing;

  const effectiveAt = inventoryItem.lastUpdated || inventoryItem.updatedAt || inventoryItem.createdAt || new Date();
  try {
    return await InventoryEvent.create({
      householdId: inventoryItem.householdId,
      inventoryItemId: inventoryItem._id,
      itemId: inventoryItem.itemId,
      type: 'baseline',
      absoluteQuantity: Math.max(0, Number(inventoryItem.quantity) || 0),
      effectiveAt,
      sourceIdentity: `baseline:${inventoryItem._id}`,
      sourceType: 'inventory-item'
    });
  } catch (err) {
    if (err?.code === 11000) {
      return InventoryEvent.findOne({ householdId: inventoryItem.householdId, sourceIdentity: `baseline:${inventoryItem._id}` });
    }
    throw err;
  }
}

async function currentQuantityForItem(inventoryItem) {
  await ensureBaselineEvent(inventoryItem);
  const events = await InventoryEvent.find({
    householdId: inventoryItem.householdId,
    inventoryItemId: inventoryItem._id
  }).lean();
  return deriveQuantity(events, inventoryItem.quantity);
}

async function syncMaterializedQuantity(inventoryItem) {
  const quantity = await currentQuantityForItem(inventoryItem);
  if (Number(inventoryItem.quantity) !== quantity) {
    inventoryItem.quantity = quantity;
    inventoryItem.lastUpdated = new Date();
    await inventoryItem.save();
  }
  return quantity;
}

async function appendAbsoluteCount(inventoryItem, quantity, options = {}) {
  await ensureBaselineEvent(inventoryItem);
  const effectiveAt = options.effectiveAt || new Date();
  const event = await InventoryEvent.create({
    householdId: inventoryItem.householdId,
    inventoryItemId: inventoryItem._id,
    itemId: inventoryItem.itemId,
    type: 'absolute_count',
    absoluteQuantity: Math.max(0, Number(quantity) || 0),
    effectiveAt,
    sourceIdentity: options.sourceIdentity || null,
    sourceType: options.sourceType || 'manual',
    sourceEntityId: options.sourceEntityId || null,
    sourceMeta: options.sourceMeta || null,
    createdBy: options.createdBy || null
  });
  await syncMaterializedQuantity(inventoryItem);
  return event;
}

async function appendDelta(inventoryItem, type, quantityDelta, options = {}) {
  await ensureBaselineEvent(inventoryItem);
  let event;
  try {
    event = await InventoryEvent.create({
      householdId: inventoryItem.householdId,
      inventoryItemId: inventoryItem._id,
      itemId: inventoryItem.itemId,
      type,
      quantityDelta: roundQuantity(quantityDelta),
      effectiveAt: options.effectiveAt || new Date(),
      sourceIdentity: options.sourceIdentity || null,
      sourceType: options.sourceType || null,
      sourceEntityId: options.sourceEntityId || null,
      sourceMeta: options.sourceMeta || null,
      reversesEventId: options.reversesEventId || null,
      createdBy: options.createdBy || null
    });
  } catch (err) {
    if (err?.code !== 11000 || !options.sourceIdentity) throw err;
    event = await InventoryEvent.findOne({
      householdId: inventoryItem.householdId,
      sourceIdentity: options.sourceIdentity
    });
  }
  await syncMaterializedQuantity(inventoryItem);
  return event;
}

module.exports = {
  appendAbsoluteCount,
  appendDelta,
  currentQuantityForItem,
  deriveQuantity,
  ensureBaselineEvent,
  eventOrder,
  roundQuantity,
  syncMaterializedQuantity
};
