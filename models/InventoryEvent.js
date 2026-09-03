const mongoose = require('mongoose');

const EVENT_TYPES = [
  'baseline',
  'absolute_count',
  'shopping_replenishment',
  'meal_consumption',
  'manual_adjustment',
  'correction',
  'reversal'
];

const inventoryEventSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  type: { type: String, enum: EVENT_TYPES, required: true },
  // Delta events add this value to the ledger. Absolute events instead set quantity.
  quantityDelta: { type: Number, default: null },
  absoluteQuantity: { type: Number, min: 0, default: null },
  effectiveAt: { type: Date, required: true },
  recordedAt: { type: Date, default: Date.now, required: true },
  sourceIdentity: { type: String, trim: true, default: null },
  sourceType: { type: String, trim: true, default: null },
  sourceEntityId: { type: String, trim: true, default: null },
  sourceMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  reversesEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryEvent', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

inventoryEventSchema.index({ householdId: 1, itemId: 1, effectiveAt: 1, recordedAt: 1 });
inventoryEventSchema.index(
  { householdId: 1, sourceIdentity: 1 },
  { unique: true, partialFilterExpression: { sourceIdentity: { $type: 'string' } } }
);
inventoryEventSchema.index(
  { householdId: 1, reversesEventId: 1, type: 1 },
  { unique: true, partialFilterExpression: { reversesEventId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('InventoryEvent', inventoryEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
