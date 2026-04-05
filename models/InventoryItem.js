const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, default: 0 },
  unit: { type: String, trim: true },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastUpdated: { type: Date, default: Date.now },
  notes: { type: String, trim: true }
}, { timestamps: true });

// Unique per household + item
inventoryItemSchema.index({ householdId: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
