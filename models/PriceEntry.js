const mongoose = require('mongoose');

const priceEntrySchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  regularPrice: { type: Number, required: true },         // shelf price
  salePrice: { type: Number, default: null },             // discounted shelf price; null if not on sale
  couponAmount: { type: Number, default: null },          // amount off from coupon; null if no coupon
  couponCode: { type: String, trim: true, default: null }, // e.g. "Ibotta", "Store app"
  finalPrice: { type: Number, required: true },           // (salePrice ?? regularPrice) - (couponAmount ?? 0)
  quantity: { type: Number, required: true, default: 1 },
  pricePerUnit: { type: Number, required: true },         // finalPrice / quantity
  date: { type: Date, default: Date.now },
  source: { type: String, enum: ['manual', 'receipt'], default: 'manual' },
  status: { type: String, enum: ['approved', 'pending'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  notes: { type: String, trim: true }
}, { timestamps: true });

priceEntrySchema.index({ householdId: 1, itemId: 1, date: -1 });
priceEntrySchema.index({ householdId: 1, status: 1 });
priceEntrySchema.index({ householdId: 1, storeId: 1 });

module.exports = mongoose.model('PriceEntry', priceEntrySchema);
