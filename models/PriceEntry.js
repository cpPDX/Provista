const mongoose = require('mongoose');

const priceEntrySchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 },
  pricePerUnit: { type: Number, required: true },
  isOnSale: { type: Boolean, default: false },
  saleLabel: { type: String, trim: true },
  date: { type: Date, default: Date.now },
  source: { type: String, enum: ['manual', 'receipt'], default: 'manual' },
  notes: { type: String, trim: true }
}, { timestamps: true });

priceEntrySchema.index({ itemId: 1, date: -1 });
priceEntrySchema.index({ storeId: 1 });

module.exports = mongoose.model('PriceEntry', priceEntrySchema);
