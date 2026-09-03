const mongoose = require('mongoose');

const shoppingListItemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  // Backward-compatible intended purchase quantity. Existing callers can keep
  // reading/writing `quantity`; PRO-75 makes its meaning explicit rather than
  // overloading it as required and actually purchased quantity too.
  quantity: { type: Number, required: true, default: 1, min: 0.01, max: 99 },
  // System-derived unresolved demand. Null means there is no separate generated
  // requirement (for example, a manually added household extra).
  requiredQuantity: { type: Number, default: null, min: 0, max: 99 },
  // Distinguishes untouched generated quantities from a parent's explicit choice.
  quantitySource: { type: String, enum: ['system', 'user'], default: 'user' },
  // What was actually obtained. It becomes meaningful once the item is checked
  // and remains editable until Finish shopping.
  actualPurchasedQuantity: { type: Number, default: null, min: 0, max: 99 },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  checked: { type: Boolean, default: false },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedAt: { type: Date, default: Date.now },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removedAt: { type: Date, default: null },
  lastConflict: {
    resolvedAt: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winnerName: { type: String },
    overwrittenValue: { type: mongoose.Schema.Types.Mixed }
  }
}, { timestamps: true });

module.exports = mongoose.model('ShoppingListItem', shoppingListItemSchema);
