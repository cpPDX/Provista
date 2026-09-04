const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  location: { type: String, trim: true },
  address: {
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'US' }
  },
  coordinates: {
    lat: { type: Number, min: -90, max: 90, default: null },
    lon: { type: Number, min: -180, max: 180, default: null }
  },
  // Provider-specific store/location identifiers. Keep these generic so
  // adding another external price source does not require a Store migration.
  externalIds: { type: Map, of: String, default: {} },
  lastConflict: {
    resolvedAt: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winnerName: { type: String },
    overwrittenValue: { type: mongoose.Schema.Types.Mixed }
  }
}, { timestamps: true });

// Supports the household-scoped alphabetical lookup used by GET /api/stores.
storeSchema.index({ householdId: 1, name: 1 });

module.exports = mongoose.model('Store', storeSchema);
