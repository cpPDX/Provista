const mongoose = require('mongoose');

const shoppingListItemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, default: 1 },
  checked: { type: Boolean, default: false },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedAt: { type: Date, default: Date.now },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('ShoppingListItem', shoppingListItemSchema);
