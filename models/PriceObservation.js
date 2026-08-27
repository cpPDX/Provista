const mongoose = require('mongoose');

// External/catalog pricing is intentionally separate from PriceEntry.
// PriceEntry means "the household paid or submitted this price" and feeds Spend.
// PriceObservation means "an external source reported this price" and is advisory.
const priceObservationSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },

  provider: { type: String, required: true, trim: true, lowercase: true },
  providerProductId: { type: String, trim: true, default: null },
  providerLocationId: { type: String, trim: true, default: null },

  // Effective price at observation time. Optional list/sale prices preserve
  // provider detail without changing the meaning of the effective value.
  price: { type: Number, required: true, min: 0 },
  regularPrice: { type: Number, min: 0, default: null },
  salePrice: { type: Number, min: 0, default: null },
  pricePerUnit: { type: Number, min: 0, default: null },
  currency: { type: String, trim: true, uppercase: true, default: 'USD' },

  observedAt: { type: Date, required: true },
  fetchedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },

  matchMethod: {
    type: String,
    enum: ['upc', 'provider-id', 'name', 'manual'],
    required: true
  },
  confidence: { type: Number, min: 0, max: 1, required: true },
  sourceUrl: { type: String, trim: true, default: null }
}, { timestamps: true });

priceObservationSchema.index({ householdId: 1, itemId: 1, storeId: 1, observedAt: -1 });
priceObservationSchema.index({ householdId: 1, provider: 1, observedAt: -1 });
priceObservationSchema.index({ provider: 1, providerProductId: 1, providerLocationId: 1, observedAt: -1 });

module.exports = mongoose.model('PriceObservation', priceObservationSchema);
