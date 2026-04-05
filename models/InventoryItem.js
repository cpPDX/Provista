const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true, unique: true },
  quantity: { type: Number, required: true, default: 0 },
  unit: { type: String, trim: true },
  lastUpdated: { type: Date, default: Date.now },
  notes: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
