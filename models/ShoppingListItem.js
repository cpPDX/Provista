const mongoose = require('mongoose');

const shoppingListItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, default: 1 },
  checked: { type: Boolean, default: false },
  addedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('ShoppingListItem', shoppingListItemSchema);
