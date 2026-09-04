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

function withSession(query, session) {
  return session ? query.session(session) : query;
}

async function createEvent(document, session) {
  if (!session) return InventoryEvent.create(document);
  const created = await InventoryEvent.create([document], { session });
  return created[0];
}

async function ensureBaselineEvent(inventoryItem, options = {}) {
  const session = options.session || null;
  const existing = await withSession(InventoryEvent.findOne({
    householdId: inventoryItem.householdId,
    inventoryItemId: inventoryItem._id,
    type: 'baseline'
  }), session).lean();
  if (existing) return existing;

  const effectiveAt = options.effectiveAt || inventoryItem.lastUpdated || inventoryItem.updatedAt || inventoryItem.createdAt || new Date();
  const absoluteQuantity = options.absoluteQuantity == null
    ? Math.max(0, Number(inventoryItem.quantity) || 0)
    : Math.max(0, Number(options.absoluteQuantity) || 0);
  try {
    return await createEvent({
      householdId: inventoryItem.householdId,
      inventoryItemId: inventoryItem._id,
      itemId: inventoryItem.itemId,
      type: 'baseline',
      absoluteQuantity,
      effectiveAt,
      sourceIdentity: `baseline:${inventoryItem._id}`,
      sourceType: 'inventory-item'
    }, session);
  } catch (err) {
    if (err?.code === 11000) {
      return withSession(InventoryEvent.findOne({
        householdId: inventoryItem.householdId,
        sourceIdentity: `baseline:${inventoryItem._id}`
      }), session);
    }
    throw err;
  }
}

async function currentQuantityForItem(inventoryItem, options = {}) {
  const session = options.session || null;
  await ensureBaselineEvent(inventoryItem, { session });
  const events = await withSession(InventoryEvent.find({
    householdId: inventoryItem.householdId,
    inventoryItemId: inventoryItem._id
  }), session).lean();
  return deriveQuantity(events, inventoryItem.quantity);
}

async function syncMaterializedQuantity(inventoryItem, options = {}) {
  const session = options.session || null;
  const quantity = await currentQuantityForItem(inventoryItem, { session });
  if (Number(inventoryItem.quantity) !== quantity) {
    inventoryItem.quantity = quantity;
    inventoryItem.lastUpdated = new Date();
    await inventoryItem.save(session ? { session } : undefined);
  }
  return quantity;
}

async function appendAbsoluteCount(inventoryItem, quantity, options = {}) {
  const session = options.session || null;
  await ensureBaselineEvent(inventoryItem, { session });
  const effectiveAt = options.effectiveAt || new Date();
  const event = await createEvent({
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
  }, session);
  await syncMaterializedQuantity(inventoryItem, { session });
  return event;
}

async function appendDelta(inventoryItem, type, quantityDelta, options = {}) {
  const session = options.session || null;
  await ensureBaselineEvent(inventoryItem, { session });
  let event;
  try {
    event = await createEvent({
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
    }, session);
  } catch (err) {
    if (err?.code !== 11000 || !options.sourceIdentity) throw err;
    event = await withSession(InventoryEvent.findOne({
      householdId: inventoryItem.householdId,
      sourceIdentity: options.sourceIdentity
    }), session);
  }
  await syncMaterializedQuantity(inventoryItem, { session });
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
